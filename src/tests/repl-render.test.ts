import { describe, it, expect, beforeEach } from "bun:test";

/** Strip all ANSI escape codes from a string. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b[78]/g, "");
}

// ─── Inline rendering helpers (mirrors repl.ts logic) ────────────────────────
// These are pure extractions of the closure logic in repl.ts so we can test
// them without spinning up a full REPL or readline interface.

/** Mirror of the status-content logic inside showPrompt(). */
function buildStatusContent(opts: {
  provider: string;
  model: string;
  messageCount: number;
  pendingClipImage?: boolean;
  mlBufferLen?: number;
}): string {
  const { provider, model, messageCount, pendingClipImage = false, mlBufferLen = 0 } = opts;
  if (pendingClipImage) {
    return "  📋 Image in clipboard · Ctrl+V to paste";
  }
  const msgsStr = messageCount > 0
    ? ` · ${messageCount} msg${messageCount !== 1 ? "s" : ""}`
    : "";
  const mlStr = mlBufferLen > 0 ? ` · ${mlBufferLen + 1} lines` : "";
  return `  ${provider} · ${model}${msgsStr}${mlStr}`;
}

/**
 * Mirror of the submitted-line rewrite logic in the "line" handler.
 * Returns the display string written to the terminal after the user presses Enter.
 * In real code this is chalk.dim("  › " + display), here we test the structure.
 */
function formatSubmittedLine(fullInput: string): string {
  const input = fullInput.trim();
  if (!input) return "";
  const display = fullInput.includes("\n")
    ? (fullInput.split("\n")[0] ?? "") + " ···"
    : input;
  return `  › ${display}`;
}

// ─── Bracketed paste normalizer (mirrors the closure in repl.ts) ──────────────

type PasteState = { mode: boolean; buf: string };

/**
 * Process one "data" chunk through the bracketed-paste interceptor.
 * Returns the normalized string to emit, or null to swallow the chunk.
 */
function processPasteChunk(state: PasteState, chunk: string): string | null {
  if (!chunk.includes("\x1b[200~") && !state.mode) {
    return chunk; // not a paste chunk — pass through
  }
  if (!state.mode) { state.mode = true; state.buf = ""; }
  state.buf += chunk.replace("\x1b[200~", "");
  if (state.buf.includes("\x1b[201~")) {
    const normalized = state.buf
      .replace("\x1b[201~", "")
      .replace(/[\r\n]+/g, " ")
      .trimEnd();
    state.mode = false;
    state.buf = "";
    return normalized;
  }
  return null; // still accumulating
}

// ─── Multi-line buffer logic (mirrors the line-handler in repl.ts) ────────────

type MlState = { buf: string[]; altPending: boolean };

/**
 * Simulate one "line" event from readline.
 * Returns the full message to send (joined), or null if still accumulating.
 */
function processLine(state: MlState, raw: string): string | null {
  if (state.altPending) {
    state.altPending = false;
    state.buf.push(raw);
    return null; // not ready yet — still in multi-line mode
  }
  let fullInput = raw;
  if (state.buf.length > 0) {
    fullInput = [...state.buf, raw].join("\n");
    state.buf = [];
  }
  return fullInput.trim() || null;
}

// ─── Shell escape routing (mirrors !-prefix logic in repl.ts) ─────────────────

type InputRoute = "shell" | "slash" | "chat" | "empty";

/**
 * Determine how an input line would be routed in the REPL.
 * Mirrors the if-chain in the "line" handler.
 */
function routeInput(fullInput: string): { route: InputRoute; shellCmd?: string } {
  const input = fullInput.trim();
  if (!input) return { route: "empty" };
  if (input.startsWith("!")) {
    // Shell escape: strip leading whitespace + "!" from the raw fullInput
    const shellCmd = fullInput.replace(/^\s*!/, "");
    return { route: "shell", shellCmd };
  }
  if (input.startsWith("/")) return { route: "slash" };
  return { route: "chat" };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("status content formatting", () => {
  it("shows only provider and model when 0 messages", () => {
    const s = stripAnsi(buildStatusContent({ provider: "claude", model: "opus", messageCount: 0 }));
    expect(s).toContain("claude");
    expect(s).toContain("opus");
    expect(s).not.toContain("msg");
  });

  it("shows '1 msg' (singular) for exactly 1 message", () => {
    const s = stripAnsi(buildStatusContent({ provider: "claude", model: "opus", messageCount: 1 }));
    expect(s).toContain("1 msg");
    expect(s).not.toContain("msgs");
  });

  it("shows 'N msgs' (plural) for N > 1 messages", () => {
    const s = stripAnsi(buildStatusContent({ provider: "claude", model: "opus", messageCount: 5 }));
    expect(s).toContain("5 msgs");
  });

  it("shows clipboard hint when pendingClipImage is true", () => {
    const s = buildStatusContent({
      provider: "claude", model: "opus", messageCount: 3, pendingClipImage: true,
    });
    expect(s).toContain("📋");
    expect(s).toContain("Ctrl+V");
    // No provider/model shown in clipboard mode
    expect(s).not.toContain("claude");
  });

  it("clipboard hint takes priority over message count", () => {
    const s = buildStatusContent({
      provider: "claude", model: "opus", messageCount: 10, pendingClipImage: true,
    });
    expect(s).not.toContain("msg");
  });

  it("shows line count suffix when multi-line buffer has entries", () => {
    // mlBufferLen = 1 → "2 lines" (1 accumulated + 1 current)
    const s = stripAnsi(buildStatusContent({
      provider: "claude", model: "default", messageCount: 0, mlBufferLen: 1,
    }));
    expect(s).toContain("2 lines");
  });

  it("shows correct line count for deeper buffer", () => {
    // mlBufferLen = 3 → "4 lines"
    const s = stripAnsi(buildStatusContent({
      provider: "claude", model: "default", messageCount: 0, mlBufferLen: 3,
    }));
    expect(s).toContain("4 lines");
  });

  it("no line count suffix when buffer is empty", () => {
    const s = stripAnsi(buildStatusContent({
      provider: "claude", model: "default", messageCount: 0, mlBufferLen: 0,
    }));
    expect(s).not.toContain("lines");
  });
});

// ─── Shell escape (!command) routing ─────────────────────────────────────────

describe("shell escape (!command) routing", () => {
  it("!ls routes to shell with cmd 'ls'", () => {
    const r = routeInput("!ls");
    expect(r.route).toBe("shell");
    expect(r.shellCmd).toBe("ls");
  });

  it("!echo hello world preserves args", () => {
    const r = routeInput("!echo hello world");
    expect(r.route).toBe("shell");
    expect(r.shellCmd).toBe("echo hello world");
  });

  it("multi-line shell command preserves newlines", () => {
    const r = routeInput("!for i in 1 2 3; do\necho $i\ndone");
    expect(r.route).toBe("shell");
    expect(r.shellCmd).toBe("for i in 1 2 3; do\necho $i\ndone");
  });

  it("! alone (no command) still routes to shell with empty cmd", () => {
    const r = routeInput("!");
    expect(r.route).toBe("shell");
    expect(r.shellCmd).toBe("");
  });

  it("leading spaces before ! are stripped from shellCmd", () => {
    const r = routeInput("  !pwd");
    expect(r.route).toBe("shell");
    expect(r.shellCmd).toBe("pwd");
  });

  it("/help routes to slash, not shell", () => {
    expect(routeInput("/help").route).toBe("slash");
  });

  it("plain text routes to chat", () => {
    expect(routeInput("hello world").route).toBe("chat");
  });

  it("empty input routes to empty", () => {
    expect(routeInput("").route).toBe("empty");
    expect(routeInput("   ").route).toBe("empty");
  });
});

// ─── Submitted-line rewrite formatting ───────────────────────────────────────
// New behaviour: when the user presses Enter, the "🐝 › input" prompt line is
// rewritten as "  › input" (gray, no bee).  Multi-line inputs show "first ···".

describe("submitted line rewrite format", () => {
  it("single-line input formats as '  › message'", () => {
    expect(formatSubmittedLine("hello world")).toBe("  › hello world");
  });

  it("input is trimmed for display", () => {
    expect(formatSubmittedLine("  spaces  ")).toBe("  › spaces");
  });

  it("multi-line input shows first line + '···'", () => {
    expect(formatSubmittedLine("first line\nsecond line")).toBe("  › first line ···");
  });

  it("multi-line with 3 parts shows first line + '···'", () => {
    expect(formatSubmittedLine("a\nb\nc")).toBe("  › a ···");
  });

  it("empty input returns empty string (no rewrite)", () => {
    expect(formatSubmittedLine("")).toBe("");
  });

  it("whitespace-only input returns empty string", () => {
    expect(formatSubmittedLine("   ")).toBe("");
  });

  it("format does not start with bee emoji", () => {
    const result = formatSubmittedLine("any message");
    expect(result).not.toContain("🐝");
  });

  it("format uses › chevron (not >)", () => {
    const result = formatSubmittedLine("msg");
    expect(result).toContain("›");
  });

  it("single-line: display is trimmed content, not raw fullInput", () => {
    // fullInput might have leading/trailing whitespace from paste etc.
    const result = formatSubmittedLine("  trimmed  ");
    expect(result).toBe("  › trimmed");
  });
});

// ─── showPrompt new contract ──────────────────────────────────────────────────
// With the ReplLayout, showPrompt() no longer writes status/separator as static
// text above the prompt.  Status lives in the fixed bottom rows managed by
// ReplLayout.refreshStatus().  The key regressions to prevent:
//   • No DEC save/restore (\x1b7/\x1b8) in the *static prompt text path*
//   • No scroll-then-cursor-up (\n\n\x1b[2A) in the *static prompt text path*
// (ReplLayout uses save/restore internally but only for fixed-row updates,
//  never while the scroll region is shifting — that's what made it safe.)

describe("showPrompt: new static-text contract", () => {
  it("buildStatusContent does NOT contain \\x1b7 (DEC save)", () => {
    const s = buildStatusContent({ provider: "p", model: "m", messageCount: 5 });
    expect(s).not.toContain("\x1b7");
  });

  it("buildStatusContent does NOT contain \\x1b8 (DEC restore)", () => {
    const s = buildStatusContent({ provider: "p", model: "m", messageCount: 5 });
    expect(s).not.toContain("\x1b8");
  });

  it("buildStatusContent does NOT contain scroll-then-up sequence", () => {
    const s = buildStatusContent({ provider: "p", model: "m", messageCount: 5 });
    expect(s).not.toContain("\n\n\x1b[2A");
  });

  it("formatSubmittedLine does NOT contain cursor-escape sequences", () => {
    // The rewrite line is: \x1b[A\x1b[2K + display + \n
    // The *display string itself* (what we test here) must be plain text
    const display = formatSubmittedLine("hello");
    expect(display).not.toContain("\x1b");
  });

  // Regression: old showPrompt wrote status+separator as static text above
  // the prompt, which readline's \x1b[0J erased on every keypress.
  // New showPrompt() emits NO static text (status goes to fixed row via
  // ReplLayout.refreshStatus()).  We verify this contract by checking the
  // status content helper produces no separator characters.
  it("buildStatusContent does NOT produce a separator line (─ chars)", () => {
    const s = buildStatusContent({ provider: "p", model: "m", messageCount: 0 });
    expect(s).not.toContain("─");
  });
});

// ─── Bracketed paste normalization ───────────────────────────────────────────

describe("bracketed paste normalization", () => {
  let state: PasteState;
  beforeEach(() => { state = { mode: false, buf: "" }; });

  it("passes normal (non-paste) input through unchanged", () => {
    expect(processPasteChunk(state, "hello")).toBe("hello");
  });

  it("swallows the paste-start chunk and returns null", () => {
    expect(processPasteChunk(state, "\x1b[200~some text")).toBeNull();
    expect(state.mode).toBe(true);
  });

  it("returns normalized text when paste-end marker arrives", () => {
    state = { mode: false, buf: "" };
    const result = processPasteChunk(state, "\x1b[200~line one\nline two\x1b[201~");
    expect(result).toBe("line one line two");
  });

  it("normalizes single \\n to space", () => {
    const result = processPasteChunk(state, "\x1b[200~a\nb\x1b[201~");
    expect(result).toBe("a b");
  });

  it("normalizes \\r\\n to space", () => {
    const result = processPasteChunk(state, "\x1b[200~a\r\nb\x1b[201~");
    expect(result).toBe("a b");
  });

  it("normalizes multiple consecutive newlines to a single space", () => {
    const result = processPasteChunk(state, "\x1b[200~a\n\n\nb\x1b[201~");
    expect(result).toBe("a b");
  });

  it("trims trailing whitespace from paste result", () => {
    const result = processPasteChunk(state, "\x1b[200~hello  \n\x1b[201~");
    expect(result).toBe("hello");
  });

  it("handles paste spread across two chunks", () => {
    const r1 = processPasteChunk(state, "\x1b[200~part one\n");
    expect(r1).toBeNull(); // still accumulating
    const r2 = processPasteChunk(state, "part two\x1b[201~");
    expect(r2).toBe("part one part two");
  });

  it("resets state after completed paste", () => {
    processPasteChunk(state, "\x1b[200~done\x1b[201~");
    expect(state.mode).toBe(false);
    expect(state.buf).toBe("");
  });

  it("preserves plain text with no newlines", () => {
    const result = processPasteChunk(state, "\x1b[200~plain text here\x1b[201~");
    expect(result).toBe("plain text here");
  });
});

describe("multi-line buffer accumulation", () => {
  let state: MlState;
  beforeEach(() => { state = { buf: [], altPending: false }; });

  it("submits a normal single line directly", () => {
    const result = processLine(state, "hello world");
    expect(result).toBe("hello world");
    expect(state.buf).toHaveLength(0);
  });

  it("returns null when altPending is true (Alt+Enter pressed)", () => {
    state.altPending = true;
    const result = processLine(state, "first line");
    expect(result).toBeNull();
    expect(state.buf).toEqual(["first line"]);
    expect(state.altPending).toBe(false);
  });

  it("joins accumulated lines on final Enter", () => {
    state.altPending = true;
    processLine(state, "line 1");
    state.altPending = true;
    processLine(state, "line 2");
    const result = processLine(state, "line 3");
    expect(result).toBe("line 1\nline 2\nline 3");
  });

  it("clears buffer after submission", () => {
    state.altPending = true;
    processLine(state, "first");
    processLine(state, "second");
    expect(state.buf).toHaveLength(0);
  });

  it("returns null for empty input (no buffer)", () => {
    const result = processLine(state, "  ");
    expect(result).toBeNull(); // trimmed to empty → null
  });

  it("returns null for empty final line when buffer is empty", () => {
    const result = processLine(state, "");
    expect(result).toBeNull();
  });

  it("correctly counts accumulated lines", () => {
    state.altPending = true; processLine(state, "a");
    state.altPending = true; processLine(state, "b");
    // buf now has 2 entries; status would show "3 lines" (buf.length+1)
    expect(state.buf.length + 1).toBe(3);
  });
});

// ─── Ctrl+C / Ctrl+D double-press state machine ──────────────────────────────
// Mirrors the emit-override logic in repl.ts.
// State: { line: string, pending: boolean, mlBuffer: string[] }
// Returns: "clear" | "arm" | "exit"

type CtrlPressState = { line: string; pending: boolean; mlBuffer: string[] };
type CtrlPressResult = "clear-and-arm" | "arm-only" | "exit" | "pass-through";

/** Pure simulation of the Ctrl+C/D handler in the stdin emit override. */
function handleCtrlKey(str: string, state: CtrlPressState): CtrlPressResult {
  if (str !== "\x03" && str !== "\x04") return "pass-through";
  if (state.pending) {
    return "exit";
  }
  if (state.line) {
    state.line = "";
    state.mlBuffer = [];
    state.pending = true;
    return "clear-and-arm";
  }
  state.pending = true;
  return "arm-only";
}

describe("Ctrl+C/D: double-press exit state machine", () => {
  let s: CtrlPressState;
  beforeEach(() => { s = { line: "", pending: false, mlBuffer: [] }; });

  // ── With empty input ────────────────────────────────────────────────────

  it("empty + first press → arm only, no visible change", () => {
    expect(handleCtrlKey("\x04", s)).toBe("arm-only");
    expect(s.pending).toBe(true);
    expect(s.line).toBe(""); // line unchanged
  });

  it("empty + second press → exit", () => {
    handleCtrlKey("\x04", s);              // arm
    expect(handleCtrlKey("\x04", s)).toBe("exit");
  });

  it("empty + Ctrl+C first → arm; Ctrl+D second → exit (keys can mix)", () => {
    handleCtrlKey("\x03", s);
    expect(handleCtrlKey("\x04", s)).toBe("exit");
  });

  it("empty + Ctrl+D first → arm; Ctrl+C second → exit", () => {
    handleCtrlKey("\x04", s);
    expect(handleCtrlKey("\x03", s)).toBe("exit");
  });

  // ── With content in input ────────────────────────────────────────────────

  it("has content + first press → clears line, arms pending", () => {
    s.line = "hello world";
    const result = handleCtrlKey("\x04", s);
    expect(result).toBe("clear-and-arm");
    expect(s.line).toBe("");
    expect(s.pending).toBe(true);
  });

  it("has content + first press → clears multi-line buffer too", () => {
    s.line = "partial";
    s.mlBuffer = ["line1", "line2"];
    handleCtrlKey("\x03", s);
    expect(s.mlBuffer).toHaveLength(0);
  });

  it("has content + second press → exit", () => {
    s.line = "something";
    handleCtrlKey("\x04", s); // clears + arms
    expect(handleCtrlKey("\x04", s)).toBe("exit");
  });

  // ── Regression: old behaviour (immediate exit always) ────────────────────

  it("old behaviour (immediate exit) is NOT what we do (regression baseline)", () => {
    // Old: \x04 always → iface.close() immediately
    // New: first press on empty → arm-only (not exit)
    s.line = "";
    s.pending = false;
    expect(handleCtrlKey("\x04", s)).not.toBe("exit"); // first press ≠ exit
  });

  // ── Pending flag resets on line submission ───────────────────────────────

  it("pending flag resets after line submit", () => {
    handleCtrlKey("\x04", s); // arm
    s.pending = false;        // simulate line-handler reset
    expect(handleCtrlKey("\x04", s)).toBe("arm-only"); // back to first-press behaviour
  });

  // ── Non-ctrl bytes pass through ──────────────────────────────────────────

  it("ordinary characters pass through", () => {
    expect(handleCtrlKey("a", s)).toBe("pass-through");
    expect(handleCtrlKey("\r", s)).toBe("pass-through");
    expect(handleCtrlKey("\n", s)).toBe("pass-through");
  });

  it("paste sequence passes through", () => {
    expect(handleCtrlKey("\x1b[200~", s)).toBe("pass-through");
  });
});

// ─── History navigation state machine ────────────────────────────────────────
// Mirrors handleHistoryUp / handleHistoryDown in repl.ts.

type HistState = {
  line: string;
  histIdx: number;         // -1 = not browsing
  histSavedLine: string;
  upPressedOnce: boolean;
  history: string[];       // [0] = most recent
};
type HistAction =
  | { kind: "cursor-to-start" }
  | { kind: "load"; entry: string }
  | { kind: "noop" }
  | { kind: "restore"; line: string };

function histUp(s: HistState): HistAction {
  if (s.histIdx === -1) {
    if (s.line && !s.upPressedOnce) {
      s.upPressedOnce = true;
      return { kind: "cursor-to-start" };
    }
    if (s.history.length === 0) { s.upPressedOnce = false; return { kind: "noop" }; }
    s.histSavedLine = s.line;
    s.histIdx = 0;
    s.upPressedOnce = false;
    s.line = s.history[0]!;
    return { kind: "load", entry: s.history[0]! };
  }
  s.upPressedOnce = false;
  if (s.histIdx < s.history.length - 1) {
    s.histIdx++;
    s.line = s.history[s.histIdx]!;
    return { kind: "load", entry: s.history[s.histIdx]! };
  }
  return { kind: "noop" }; // at oldest, stay
}

function histDown(s: HistState): HistAction {
  s.upPressedOnce = false;
  if (s.histIdx === -1) return { kind: "noop" };
  if (s.histIdx > 0) {
    s.histIdx--;
    s.line = s.history[s.histIdx]!;
    return { kind: "load", entry: s.history[s.histIdx]! };
  }
  const saved = s.histSavedLine;
  s.histIdx = -1;
  s.histSavedLine = "";
  s.line = saved;
  return { kind: "restore", line: saved };
}

function makeHist(history: string[], line = "", histIdx = -1): HistState {
  return { line, histIdx, histSavedLine: "", upPressedOnce: false, history };
}

describe("↑↓ history navigation", () => {
  // ── Empty input ──────────────────────────────────────────────────────────

  it("↑ on empty with history → loads most recent entry", () => {
    const s = makeHist(["msg3", "msg2", "msg1"]);
    const a = histUp(s);
    expect(a).toEqual({ kind: "load", entry: "msg3" });
    expect(s.histIdx).toBe(0);
  });

  it("↑↑ on empty → loads second most recent entry", () => {
    const s = makeHist(["msg3", "msg2", "msg1"]);
    histUp(s);
    const a = histUp(s);
    expect(a).toEqual({ kind: "load", entry: "msg2" });
    expect(s.histIdx).toBe(1);
  });

  it("↑ at oldest entry → stays (no wrap)", () => {
    const s = makeHist(["msg3", "msg2", "msg1"]);
    histUp(s); histUp(s); histUp(s); // now at oldest (index 2)
    const a = histUp(s);
    expect(a.kind).toBe("noop");
    expect(s.histIdx).toBe(2);
  });

  it("↑ on empty with no history → noop", () => {
    const s = makeHist([]);
    expect(histUp(s).kind).toBe("noop");
    expect(s.histIdx).toBe(-1);
  });

  it("↓ when not in history → noop", () => {
    const s = makeHist(["msg1"]);
    expect(histDown(s).kind).toBe("noop");
  });

  it("↑ then ↓ → restores original empty input", () => {
    const s = makeHist(["msg1"]);
    histUp(s);
    const a = histDown(s);
    expect(a).toEqual({ kind: "restore", line: "" });
    expect(s.histIdx).toBe(-1);
  });

  it("↑ then ↑ then ↓ → back to most recent", () => {
    const s = makeHist(["msg2", "msg1"]);
    histUp(s);        // load msg2 (idx 0)
    histUp(s);        // load msg1 (idx 1)
    const a = histDown(s); // back to msg2 (idx 0)
    expect(a).toEqual({ kind: "load", entry: "msg2" });
    expect(s.histIdx).toBe(0);
  });

  // ── Non-empty input ──────────────────────────────────────────────────────

  it("↑ on non-empty (first press) → moves cursor to start, arms flag", () => {
    const s = makeHist(["msg1"], "hello world");
    const a = histUp(s);
    expect(a.kind).toBe("cursor-to-start");
    expect(s.upPressedOnce).toBe(true);
    expect(s.histIdx).toBe(-1); // not in history yet
  });

  it("↑↑ on non-empty (second press) → enters history, saves original line", () => {
    const s = makeHist(["msg1"], "hello world");
    histUp(s);          // first: cursor to start
    const a = histUp(s); // second: enter history
    expect(a).toEqual({ kind: "load", entry: "msg1" });
    expect(s.histSavedLine).toBe("hello world");
    expect(s.histIdx).toBe(0);
  });

  it("↓ on non-empty (not in history) → noop", () => {
    const s = makeHist(["msg1"], "hello");
    expect(histDown(s).kind).toBe("noop");
  });

  it("after browsing, ↓ past most recent → restores original edited content", () => {
    const s = makeHist(["msg2", "msg1"], "my draft");
    histUp(s);  // cursor to start (upPressedOnce)
    histUp(s);  // enter history → saved = "my draft", idx = 0 (msg2)
    histDown(s); // → restore "my draft", idx = -1
    expect(s.line).toBe("my draft");
    expect(s.histIdx).toBe(-1);
  });

  it("any regular keypress resets upPressedOnce flag", () => {
    const s = makeHist(["msg1"], "hello");
    histUp(s); // arm upPressedOnce
    expect(s.upPressedOnce).toBe(true);
    // Simulate regular keypress (setImmediate handler resets flag)
    s.upPressedOnce = false;
    // Now ↑ again would arm again, not enter history
    const a = histUp(s);
    expect(a.kind).toBe("cursor-to-start");
  });

  it("entering history saves the correct in-progress line", () => {
    const s = makeHist(["msg1"], "work in progress");
    histUp(s); histUp(s); // enter history
    expect(s.histSavedLine).toBe("work in progress");
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("↑ on empty line (upPressedOnce was already set) → enters history", () => {
    const s = makeHist(["msg1"]);
    s.upPressedOnce = true; // simulate stale flag (shouldn't happen but defensive)
    const a = histUp(s);
    // Empty line + upPressedOnce → enters history (upPressedOnce doesn't block empty)
    expect(a.kind).toBe("load");
  });

  it("full cycle: browse up to oldest, then back down to empty", () => {
    const history = ["c", "b", "a"]; // c=newest, a=oldest
    const s = makeHist(history);
    histUp(s); // load c (idx 0)
    histUp(s); // load b (idx 1)
    histUp(s); // load a (idx 2) — oldest
    histUp(s); // noop (at oldest)
    histDown(s); // load b (idx 1)
    histDown(s); // load c (idx 0)
    const a = histDown(s); // restore "" (original empty)
    expect(a).toEqual({ kind: "restore", line: "" });
    expect(s.histIdx).toBe(-1);
  });
});
