import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StatusLine } from "../cli/statusline.ts";
import { ReplLayout } from "../cli/layout.ts";

// ─── Fake stdout that captures escape sequences ──────────────────────────────

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

  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });

  (process.stdout as unknown as { write: typeof process.stdout.write }).write =
    function (chunk: unknown, ..._rest: unknown[]): boolean {
      if (typeof chunk === "string") {
        captured.push(chunk);
      } else if (Buffer.isBuffer(chunk)) {
        captured.push(chunk.toString());
      }
      return true;
    } as typeof process.stdout.write;

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

function allOutput(): string {
  return captured.join("");
}

function extractCursorPositions(s: string): Array<{ row: number; col: number }> {
  const re = /\x1b\[(\d+);(\d+)H/g;
  const positions: Array<{ row: number; col: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    positions.push({ row: parseInt(m[1]!, 10), col: parseInt(m[2]!, 10) });
  }
  return positions;
}

function extractScrollRegion(s: string): { top: number; bottom: number } | null {
  const m = s.match(/\x1b\[(\d+);(\d+)r/);
  if (!m) return null;
  return { top: parseInt(m[1]!, 10), bottom: parseInt(m[2]!, 10) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ReplLayout: init()", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("sets DECSTBM scroll region to 1..rows-3", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    const region = extractScrollRegion(allOutput());
    expect(region).not.toBeNull();
    expect(region!.top).toBe(1);
    expect(region!.bottom).toBe(21); // 24 - 3
  });

  it("final cursor position is row 1, col 1 (top of scroll region)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    const positions = extractCursorPositions(allOutput());
    const last = positions[positions.length - 1];
    expect(last).toBeDefined();
    expect(last!.row).toBe(1);
    expect(last!.col).toBe(1);
  });

  it("clears the screen", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    expect(allOutput()).toContain("\x1b[2J");
  });

  it("saves initial content cursor with SCO save (\\x1b[s)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    expect(allOutput()).toContain("\x1b[s");
  });

  it("does NOT use DEC save/restore during init", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    const output = allOutput();
    expect(output).not.toContain("\x1b7");
    expect(output).not.toContain("\x1b8");
  });

  it("draws separator at row rows-2 (22)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    const positions = extractCursorPositions(allOutput());
    expect(positions.some(p => p.row === 22 && p.col === 1)).toBe(true);
  });

  it("draws prompt area at row rows-1 (23)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    const positions = extractCursorPositions(allOutput());
    expect(positions.some(p => p.row === 23 && p.col === 1)).toBe(true);
  });

  it("draws status at row rows (24)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    const positions = extractCursorPositions(allOutput());
    expect(positions.some(p => p.row === 24 && p.col === 1)).toBe(true);
  });
});

describe("ReplLayout: enterContent() uses SCO restore", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("emits SCO restore (\\x1b[u)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    captured = [];

    layout.enterContent();
    expect(allOutput()).toBe("\x1b[u");
  });
});

describe("ReplLayout: enterPrompt() moves to prompt row without saving", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("does NOT emit SCO save (only saveContent does that)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    captured = [];

    layout.enterPrompt();
    expect(allOutput()).not.toContain("\x1b[s");
  });

  it("moves to rows-1 (23) and clears line", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    captured = [];

    layout.enterPrompt();
    const output = allOutput();
    expect(output).toContain("\x1b[23;1H");
    expect(output).toContain("\x1b[2K");
  });
});

describe("ReplLayout: saveContent()", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("emits SCO save (\\x1b[s)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    captured = [];

    layout.saveContent();
    expect(allOutput()).toBe("\x1b[s");
  });
});

describe("ReplLayout: refreshStatus() uses DEC save/restore (independent of SCO)", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("uses DEC save (\\x1b7) and restore (\\x1b8)", () => {
    const status = new StatusLine();
    status.set(0, "test");
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.refreshStatus();
    const output = allOutput();
    expect(output).toContain("\x1b7");
    expect(output).toContain("\x1b8");
  });

  it("does NOT use SCO save/restore", () => {
    const status = new StatusLine();
    status.set(0, "test");
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.refreshStatus();
    const output = allOutput();
    expect(output).not.toContain("\x1b[s");
    expect(output).not.toContain("\x1b[u");
  });

  it("writes to row rows (24)", () => {
    const status = new StatusLine();
    status.set(0, "test");
    const layout = new ReplLayout(status);
    layout.init();
    captured = [];

    layout.refreshStatus();
    const positions = extractCursorPositions(allOutput());
    expect(positions.some(p => p.row === 24)).toBe(true);
  });
});

describe("ReplLayout: cleanup()", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("resets DECSTBM to full screen (\\x1b[r)", () => {
    const layout = new ReplLayout(new StatusLine());
    layout.init();
    captured = [];

    layout.cleanup();
    expect(allOutput()).toContain("\x1b[r");
  });
});

describe("ReplLayout: non-TTY is a no-op", () => {
  it("init() does nothing when not a TTY", () => {
    const origTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const origW = process.stdout.write;
    let written = false;
    (process.stdout as unknown as { write: typeof process.stdout.write }).write =
      function (): boolean { written = true; return true; } as typeof process.stdout.write;

    const layout = new ReplLayout(new StatusLine());
    layout.init();
    expect(written).toBe(false);

    (process.stdout as unknown as { write: typeof process.stdout.write }).write = origW;
    Object.defineProperty(process.stdout, "isTTY", { value: origTTY, configurable: true });
  });
});

describe("ReplLayout: small terminal (rows < 8) is a no-op", () => {
  it("init() does nothing when terminal is too small", () => {
    setupFakeStdout(6, 80);
    const layout = new ReplLayout(new StatusLine());
    layout.init();

    expect(allOutput()).not.toContain("r");
    expect(captured).toHaveLength(0);

    teardownFakeStdout();
  });
});

describe("ReplLayout: SCO vs DEC independence — content cursor survives status refresh", () => {
  beforeEach(() => setupFakeStdout(24, 80));
  afterEach(() => teardownFakeStdout());

  it("enterContent → refreshStatus → enterContent restores same position", () => {
    // This is the critical scenario: during AI streaming, the content cursor
    // is active.  refreshStatus() fires (via onStatusUpdate).  After refresh,
    // the content cursor must return to exactly where it was.
    //
    // SCO slot = content cursor, DEC slot = status refresh.  They must not
    // interfere with each other.
    const status = new StatusLine();
    status.set(0, "thinking…");
    const layout = new ReplLayout(status);
    layout.init();

    // Simulate: enterContent → write something → saveContent
    layout.enterContent();
    process.stdout.write("hello\n");
    layout.saveContent();

    // refreshStatus should NOT corrupt the SCO slot
    layout.refreshStatus();

    captured = [];
    // enterContent should restore to the position after "hello\n"
    layout.enterContent();
    const output = allOutput();
    expect(output).toBe("\x1b[u");
    // The restore goes to the saved position — DEC restore (\x1b8) in
    // refreshStatus should NOT have affected the SCO slot.
  });
});
