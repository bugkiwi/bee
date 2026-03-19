/**
 * Layout integration tests using VirtualTerminal.
 *
 * These tests simulate the REAL terminal state machine — cursor movements,
 * scroll regions, save/restore — and verify that content is visible and
 * positioned correctly.  Unlike string-capture tests, these catch bugs where
 * content is written outside the scroll region or cursor save/restore slots
 * get corrupted.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StatusLine } from "../cli/statusline.ts";
import { ReplLayout } from "../cli/layout.ts";
import { VirtualTerminal } from "./vterm.ts";

// ─── Helpers: capture layout output into VirtualTerminal ─────────────────────

const ROWS = 24;
const COLS = 80;

let vt: VirtualTerminal;
let origWrite: typeof process.stdout.write;
let origIsTTY: boolean;
let origRows: number | undefined;
let origCols: number | undefined;
let origOn: typeof process.stdout.on;

function setup(): void {
  vt = new VirtualTerminal(ROWS, COLS);

  origWrite = process.stdout.write;
  origIsTTY = process.stdout.isTTY;
  origRows = process.stdout.rows;
  origCols = process.stdout.columns;
  origOn = process.stdout.on;

  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: ROWS, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: COLS, configurable: true });

  // Feed output through VirtualTerminal instead of real terminal
  (process.stdout as unknown as { write: typeof process.stdout.write }).write =
    function (chunk: unknown, ..._rest: unknown[]): boolean {
      if (typeof chunk === "string") vt.feed(chunk);
      else if (Buffer.isBuffer(chunk)) vt.feed(chunk.toString());
      return true;
    } as typeof process.stdout.write;

  (process.stdout as unknown as { on: typeof process.stdout.on }).on =
    function (..._args: unknown[]): typeof process.stdout {
      return process.stdout;
    } as typeof process.stdout.on;
}

function teardown(): void {
  (process.stdout as unknown as { write: typeof process.stdout.write }).write = origWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: origRows, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: origCols, configurable: true });
  (process.stdout as unknown as { on: typeof process.stdout.on }).on = origOn;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("VirtualTerminal basics", () => {
  it("writes text at cursor position", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("Hello");
    expect(t.getRow(1)).toBe("Hello");
    expect(t.cursorRow).toBe(1);
    expect(t.cursorCol).toBe(6);
  });

  it("handles newline within scroll region", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("Line 1\nLine 2");
    expect(t.getRow(1)).toBe("Line 1");
    expect(t.getRow(2)).toBe("Line 2");
  });

  it("scrolls when at bottom of scroll region", () => {
    const t = new VirtualTerminal(5, 20);
    t.feed(`\x1b[1;3r`); // scroll region = rows 1-3
    t.feed("A\nB\nC\nD");
    // A scrolled off, B→row1, C→row2, D→row3
    expect(t.getRow(1)).toBe("B");
    expect(t.getRow(2)).toBe("C");
    expect(t.getRow(3)).toBe("D");
  });

  it("CUP moves cursor to absolute position", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("\x1b[10;5H");
    expect(t.cursorRow).toBe(10);
    expect(t.cursorCol).toBe(5);
  });

  it("DECSTBM sets scroll region and homes cursor", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("\x1b[5;20r");
    expect(t.scrollTop).toBe(5);
    expect(t.scrollBottom).toBe(20);
    expect(t.cursorRow).toBe(1);
  });

  it("SCO save/restore works independently of DEC", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("\x1b[5;10H");   // cursor at 5,10
    t.feed("\x1b[s");        // SCO save
    t.feed("\x1b[15;20H");   // move away
    t.feed("\x1b7");         // DEC save at 15,20
    t.feed("\x1b[1;1H");     // move to 1,1
    t.feed("\x1b[u");        // SCO restore → 5,10
    expect(t.cursorRow).toBe(5);
    expect(t.cursorCol).toBe(10);
    t.feed("\x1b8");         // DEC restore → 15,20
    expect(t.cursorRow).toBe(15);
    expect(t.cursorCol).toBe(20);
  });

  it("EL clears entire line", () => {
    const t = new VirtualTerminal(24, 80);
    t.feed("Hello World");
    t.feed("\x1b[1;1H\x1b[2K");
    expect(t.getRow(1)).toBe("");
  });
});

describe("Layout + VTerm: init produces correct state", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("sets scroll region to 1..rows-3", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    expect(vt.scrollTop).toBe(1);
    expect(vt.scrollBottom).toBe(ROWS - 3);
  });

  it("cursor is at row 1 after init (inside scroll region)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // After init, SCO save has been called.
    // The cursor position at SCO save should be inside scroll region.
    expect(vt.scoSavedPos.row).toBe(1);
    expect(vt.isRowInScrollRegion(vt.scoSavedPos.row)).toBe(true);
  });

  it("separator drawn at row rows-2", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    const sep = vt.getRow(ROWS - 2);
    expect(sep.length).toBeGreaterThan(0);
    expect(sep).toContain("─");
  });
});

describe("Layout + VTerm: content→prompt→content cycle", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("content written after init is inside scroll region", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // Write banner-like content
    process.stdout.write("Banner Line 1\n");
    process.stdout.write("Banner Line 2\n");

    expect(vt.getRow(1)).toContain("Banner Line 1");
    expect(vt.getRow(2)).toContain("Banner Line 2");
    expect(vt.isCursorInScrollRegion()).toBe(true);
  });

  it("saveContent + enterPrompt + enterContent restores to content area", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // Write some content
    process.stdout.write("Content here\n");
    const posAfterContent = { row: vt.cursorRow, col: vt.cursorCol };

    // Save content cursor, move to prompt
    layout.saveContent();
    layout.enterPrompt();

    // Cursor should now be at prompt row (rows-1)
    expect(vt.cursorRow).toBe(ROWS - 1);

    // Restore to content
    layout.enterContent();

    // Cursor should be back at the content position
    expect(vt.cursorRow).toBe(posAfterContent.row);
    expect(vt.isCursorInScrollRegion()).toBe(true);
  });

  it("enterPrompt does NOT corrupt SCO save slot", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // Write content, save
    process.stdout.write("Line A\n");
    layout.saveContent();
    const savedPos = vt.scoSavedPos;

    // enterPrompt should NOT overwrite the SCO slot
    layout.enterPrompt();
    expect(vt.scoSavedPos).toEqual(savedPos);
  });

  it("CRITICAL: multiple prompt→content cycles keep content visible", () => {
    // This is the exact bug scenario:
    // User submits msg1 → content written → prompt shown
    // User submits msg2 → content written → must appear BELOW msg1
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // === First message cycle ===
    layout.enterContent();
    process.stdout.write("  > msg1\n");
    process.stdout.write("Response to msg1\n");
    layout.saveContent();
    layout.enterPrompt();

    // Verify msg1 content is visible
    expect(vt.getRow(1)).toContain("> msg1");
    expect(vt.getRow(2)).toContain("Response to msg1");

    // === Second message cycle ===
    layout.enterContent();
    // Cursor should be at row 3 (after msg1 + response)
    expect(vt.cursorRow).toBe(3);
    expect(vt.isCursorInScrollRegion()).toBe(true);

    process.stdout.write("  > msg2\n");
    process.stdout.write("Response to msg2\n");
    layout.saveContent();
    layout.enterPrompt();

    // ALL content should be visible
    expect(vt.getRow(1)).toContain("> msg1");
    expect(vt.getRow(2)).toContain("Response to msg1");
    expect(vt.getRow(3)).toContain("> msg2");
    expect(vt.getRow(4)).toContain("Response to msg2");
  });

  it("CRITICAL: showPrompt-before-drainQueue does not corrupt content cursor", () => {
    // Simulates the real flow:
    // 1. User at prompt row, presses Enter
    // 2. showPrompt() called (cursor at prompt row)
    // 3. drainQueue → enterContent() must restore to CONTENT area, not prompt
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // Write initial content + save
    process.stdout.write("Initial content\n");
    layout.saveContent();

    // Enter prompt (like showPrompt does)
    layout.enterPrompt();
    expect(vt.cursorRow).toBe(ROWS - 1); // at prompt row

    // User "types" and presses enter.
    // In real code, showPrompt() is called again here — but it should NOT
    // call saveContent/\x1b[s.  enterPrompt does NOT save.

    // Now drainQueue starts
    layout.enterContent();

    // Must be in content area, NOT at prompt row
    expect(vt.cursorRow).toBe(2); // after "Initial content\n"
    expect(vt.isCursorInScrollRegion()).toBe(true);
    expect(vt.cursorRow).not.toBe(ROWS - 1);
  });
});

describe("Layout + VTerm: refreshStatus during streaming", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("refreshStatus does not move content cursor", () => {
    const status = new StatusLine();
    status.set(0, "thinking…");
    const layout = new ReplLayout(status);
    layout.init();

    // Simulate streaming: cursor in content area
    layout.enterContent();
    process.stdout.write("Streaming text ");
    const posBeforeRefresh = { row: vt.cursorRow, col: vt.cursorCol };

    // Status update fires mid-stream
    layout.refreshStatus();

    // Cursor must return to exact same position
    expect(vt.cursorRow).toBe(posBeforeRefresh.row);
    expect(vt.cursorCol).toBe(posBeforeRefresh.col);
  });
});

describe("Layout + VTerm: scroll region overflow", () => {
  beforeEach(() => {
    // Use a small terminal to test scrolling
    vt = new VirtualTerminal(10, 40);
    origWrite = process.stdout.write;
    origIsTTY = process.stdout.isTTY;
    origRows = process.stdout.rows;
    origCols = process.stdout.columns;
    origOn = process.stdout.on;

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "rows", { value: 10, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });

    (process.stdout as unknown as { write: typeof process.stdout.write }).write =
      function (chunk: unknown, ..._rest: unknown[]): boolean {
        if (typeof chunk === "string") vt.feed(chunk);
        else if (Buffer.isBuffer(chunk)) vt.feed(chunk.toString());
        return true;
      } as typeof process.stdout.write;

    (process.stdout as unknown as { on: typeof process.stdout.on }).on =
      function (..._args: unknown[]): typeof process.stdout {
        return process.stdout;
      } as typeof process.stdout.on;
  });
  afterEach(teardown);

  it("content scrolls within region when it exceeds scroll region height", () => {
    // rows=10, scroll region = 1..7 (10-3)
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    expect(vt.scrollBottom).toBe(7);

    // Write 10 lines — more than the 7-row scroll region
    for (let i = 1; i <= 10; i++) {
      process.stdout.write(`Line ${i}\n`);
    }

    // Cursor should still be inside scroll region
    expect(vt.isCursorInScrollRegion()).toBe(true);

    // The most recent lines should be visible (earlier ones scrolled off)
    // Line 10 was the last \n, cursor is at row 7 (bottom of scroll region)
    expect(vt.cursorRow).toBe(7);
  });

  it("save/restore works after scrolling", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    // Fill scroll region and trigger scrolling
    for (let i = 1; i <= 10; i++) {
      process.stdout.write(`Line ${i}\n`);
    }
    layout.saveContent();

    // Enter prompt and come back
    layout.enterPrompt();
    layout.enterContent();

    // Should restore to bottom of scroll region where we saved
    expect(vt.isCursorInScrollRegion()).toBe(true);
    expect(vt.cursorRow).toBe(7);
  });
});
