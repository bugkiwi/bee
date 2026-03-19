import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StatusLine } from "../cli/statusline.ts";
import { ReplLayout } from "../cli/layout.ts";

// ─── Fake stdout that captures escape sequences ──────────────────────────────
// We monkey-patch process.stdout to capture writes without a real TTY.

let captured: string[] = [];
let origWrite: typeof process.stdout.write;
let origIsTTY: boolean;
let origRows: number | undefined;
let origCols: number | undefined;
let origOn: typeof process.stdout.on;

function setupFakeStdout(rows = 24, cols = 80): void {
  captured = [];
  origWrite = process.stdout.write;
  origIsTTY = process.stdout.isTTY;
  origRows = process.stdout.rows;
  origCols = process.stdout.columns;
  origOn = process.stdout.on;

  // Fake isTTY, rows, columns
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });

  // Capture writes instead of sending to terminal
  (process.stdout as unknown as { write: typeof process.stdout.write }).write =
    function (chunk: unknown, ..._rest: unknown[]): boolean {
      if (typeof chunk === "string") {
        captured.push(chunk);
      } else if (Buffer.isBuffer(chunk)) {
        captured.push(chunk.toString());
      }
      return true;
    } as typeof process.stdout.write;

  // Stub .on("resize") to avoid real listener leaks
  (process.stdout as unknown as { on: typeof process.stdout.on }).on =
    function (..._args: unknown[]): typeof process.stdout {
      return process.stdout;
    } as typeof process.stdout.on;
}

function teardownFakeStdout(): void {
  (process.stdout as unknown as { write: typeof process.stdout.write }).write = origWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: origRows, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: origCols, configurable: true });
  (process.stdout as unknown as { on: typeof process.stdout.on }).on = origOn;
}

/** Get all captured output as a single string. */
function allOutput(): string {
  return captured.join("");
}

/** Extract all CUP (Cursor Position) sequences like \x1b[R;CH */
function extractCursorPositions(s: string): Array<{ row: number; col: number }> {
  const re = /\x1b\[(\d+);(\d+)H/g;
  const positions: Array<{ row: number; col: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    positions.push({ row: parseInt(m[1]!, 10), col: parseInt(m[2]!, 10) });
  }
  return positions;
}

/** Check if the string contains a DECSTBM sequence \x1b[T;Br */
function extractScrollRegion(s: string): { top: number; bottom: number } | null {
  const m = s.match(/\x1b\[(\d+);(\d+)r/);
  if (!m) return null;
  return { top: parseInt(m[1]!, 10), bottom: parseInt(m[2]!, 10) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ReplLayout: init() cursor positioning", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("sets DECSTBM scroll region to 1..rows-3", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const region = extractScrollRegion(allOutput());
    expect(region).not.toBeNull();
    expect(region!.top).toBe(1);
    expect(region!.bottom).toBe(21); // 24 - 3
  });

  it("last cursor position after init() is row 1, col 1 (top of scroll region)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const output = allOutput();
    const positions = extractCursorPositions(output);
    // The very last CUP sequence should place cursor at row 1, col 1
    const last = positions[positions.length - 1];
    expect(last).toBeDefined();
    expect(last!.row).toBe(1);
    expect(last!.col).toBe(1);
  });

  it("clears the screen before setting up layout", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const output = allOutput();
    // \x1b[2J = clear entire screen
    expect(output).toContain("\x1b[2J");
  });

  it("does NOT use DEC save/restore (\\x1b7/\\x1b8) during init", () => {
    // Save/restore during init is the root cause of the invisible cursor bug:
    // it restores the cursor to the pre-init position (shell prompt area)
    // which is in the fixed rows, outside the scroll region.
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const output = allOutput();
    expect(output).not.toContain("\x1b7");
    expect(output).not.toContain("\x1b8");
  });

  it("draws separator at row rows-2 (22)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const positions = extractCursorPositions(allOutput());
    const hasRow22 = positions.some(p => p.row === 22 && p.col === 1);
    expect(hasRow22).toBe(true);
  });

  it("draws prompt area at row rows-1 (23)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const positions = extractCursorPositions(allOutput());
    const hasRow23 = positions.some(p => p.row === 23 && p.col === 1);
    expect(hasRow23).toBe(true);
  });

  it("draws status at row rows (24)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    const positions = extractCursorPositions(allOutput());
    const hasRow24 = positions.some(p => p.row === 24 && p.col === 1);
    expect(hasRow24).toBe(true);
  });

  it("contentRow starts at 1 after init", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    expect(layout.contentRow).toBe(1);
  });
});

describe("ReplLayout: enterContent() positions cursor correctly", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("enterContent() moves cursor to contentRow", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    captured = []; // clear init output

    layout.enterContent();
    const positions = extractCursorPositions(allOutput());
    expect(positions).toHaveLength(1);
    expect(positions[0]!.row).toBe(1); // contentRow starts at 1
    expect(positions[0]!.col).toBe(1);
  });

  it("enterContent() after advanceContent(5) moves to row 6", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    layout.advanceContent(5);
    captured = [];

    layout.enterContent();
    const positions = extractCursorPositions(allOutput());
    expect(positions[0]!.row).toBe(6);
  });

  it("enterContent() clamps to rows-3 when contentRow exceeds scroll region", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    layout.advanceContent(100); // way past scroll region
    captured = [];

    layout.enterContent();
    const positions = extractCursorPositions(allOutput());
    expect(positions[0]!.row).toBe(21); // rows-3 = 24-3
  });
});

describe("ReplLayout: enterPrompt() positions cursor at fixed prompt row", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("enterPrompt() moves cursor to rows-1 (23)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.enterPrompt();
    const positions = extractCursorPositions(allOutput());
    expect(positions[0]!.row).toBe(23);
    expect(positions[0]!.col).toBe(1);
  });

  it("enterPrompt() clears the prompt line (\\x1b[2K)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.enterPrompt();
    expect(allOutput()).toContain("\x1b[2K");
  });
});

describe("ReplLayout: refreshStatus() uses save/restore correctly", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("refreshStatus() saves and restores cursor", () => {
    const status = new StatusLine();
    status.set(0, "test status");
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.refreshStatus();
    const output = allOutput();
    expect(output).toContain("\x1b7"); // save
    expect(output).toContain("\x1b8"); // restore
  });

  it("refreshStatus() writes to row rows (24)", () => {
    const status = new StatusLine();
    status.set(0, "test status");
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.refreshStatus();
    const positions = extractCursorPositions(allOutput());
    expect(positions.some(p => p.row === 24)).toBe(true);
  });
});

describe("ReplLayout: advanceContent() clamping", () => {
  it("advances contentRow by n", () => {
    setupFakeStdout(24, 80);
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    layout.advanceContent(3);
    expect(layout.contentRow).toBe(4); // 1 + 3

    teardownFakeStdout();
  });

  it("clamps contentRow to rows-3", () => {
    setupFakeStdout(24, 80);
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    layout.advanceContent(100);
    expect(layout.contentRow).toBe(21); // 24 - 3

    teardownFakeStdout();
  });

  it("multiple advances accumulate", () => {
    setupFakeStdout(24, 80);
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    layout.advanceContent(2);
    layout.advanceContent(3);
    expect(layout.contentRow).toBe(6); // 1 + 2 + 3

    teardownFakeStdout();
  });
});

describe("ReplLayout: cleanup() resets scroll region", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("cleanup() resets DECSTBM to full screen (\\x1b[r)", () => {
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.cleanup();
    expect(allOutput()).toContain("\x1b[r");
  });
});

describe("ReplLayout: non-TTY is a no-op", () => {
  it("init() does nothing when not a TTY", () => {
    // Don't fake TTY
    const origTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const origW = process.stdout.write;
    let written = false;
    (process.stdout as unknown as { write: typeof process.stdout.write }).write =
      function (): boolean { written = true; return true; } as typeof process.stdout.write;

    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    expect(written).toBe(false);
    expect(layout.contentRow).toBe(1);

    (process.stdout as unknown as { write: typeof process.stdout.write }).write = origW;
    Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true });
  });
});

describe("ReplLayout: small terminal (rows < 8) is a no-op", () => {
  it("init() does nothing when terminal is too small", () => {
    setupFakeStdout(6, 80); // too small
    const status = new StatusLine();
    const layout = new ReplLayout(status);
    layout.init();

    // No DECSTBM should be set
    expect(allOutput()).not.toContain("r");
    expect(captured).toHaveLength(0);

    teardownFakeStdout();
  });
});
