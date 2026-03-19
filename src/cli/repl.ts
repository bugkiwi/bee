import * as rl from "node:readline";
import chalk from "chalk";
import type { WorkspaceConfig } from "../types/config.ts";
import { TaskLoader } from "../tasks/loader.ts";
import { StateStore } from "../state/store.ts";
import { SessionStore } from "../state/session.ts";
import { AgentLoop } from "../agent/loop.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { Verifier } from "../verifier/index.ts";
import { VerificationReporter } from "../verifier/reporter.ts";
import { printTaskTable, colorStatus } from "./output.ts";
import { showRtkGain } from "../plugins/rtk.ts";
import { runPlan } from "./commands/plan.ts";
import { runReplay } from "./commands/replay.ts";
import { BEE_ICON } from "./bee.ts";
import { resolveCommand, SLASH_COMMANDS } from "./commands.ts";
import { clearSuggestions, showSuggestions } from "./suggestions.ts";
import { interactiveSelect } from "./select.ts";
import { ensureScreenshotDir, saveClipboardImage, clipboardImageSize } from "./screenshot.ts";
import { ChatSession } from "./chat.ts";
import { StatusLine, STATUS_PRIORITY } from "./statusline.ts";
import { ReplLayout } from "./layout.ts";
import { readJsonLines, listFiles, writeJsonFile } from "../utils/fs.ts";
import type { TraceEvent } from "../types/observability.ts";
import { join } from "node:path";


// ─── Banner ───────────────────────────────────────────────────────────────────

// Inner width of the banner box (visible chars between ║ and ║)
const BOX_W = 43;

function boxLine(content: string, visibleLen: number): string {
  const pad = " ".repeat(Math.max(0, BOX_W - visibleLen));
  return chalk.bold.cyan("║") + content + pad + chalk.bold.cyan("║");
}

function makeBanner(provider: string, useRtk: boolean): string {
  const rtkStr = useRtk ? " ⚡RTK" : "";
  const titleContent = `  ${BEE_ICON}  ${chalk.bold.yellow("BEE")} ${chalk.gray("— Claude Code Controller")}  `;
  // bee icon has 5 visible chars (◉ω◉ wrapped in parens), rest ASCII
  const titleVisible = 2 + 5 + 2 + 3 + 1 + 24 + 2;

  const provContent = `  ${chalk.gray(`provider: ${chalk.cyan(provider)}${rtkStr}`)}  `;
  const provVisible = 2 + 10 + provider.length + rtkStr.length + 2;

  const helpContent = `  ${chalk.gray("type /help for commands, /exit to quit")}  `;
  const helpVisible = 2 + 38 + 2;

  const border = "═".repeat(BOX_W);
  return [
    "",
    chalk.bold.cyan(`╔${border}╗`),
    boxLine(titleContent, titleVisible),
    boxLine(provContent, provVisible),
    boxLine(helpContent, helpVisible),
    chalk.bold.cyan(`╚${border}╝`),
    "",
  ].join("\n");
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(chalk.bold("\nAvailable commands:\n"));
  const groups = [
    { label: "Tasks",    cmds: ["status", "tasks", "run", "plan", "verify", "resume", "replay"] },
    { label: "Provider", cmds: ["provider", "switch", "session"] },
    { label: "Info",     cmds: ["config", "logs", "gain"] },
    { label: "Shell",    cmds: ["chat", "clear", "exit"] },
  ];
  for (const group of groups) {
    console.log(chalk.bold.gray(`  ${group.label}`));
    for (const name of group.cmds) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === name);
      if (!cmd) continue;
      const nameStr = chalk.cyan(`/${cmd.name}`).padEnd(20);
      const alias = cmd.alias ? chalk.gray(` /${cmd.alias}`) : "   ";
      console.log(`    ${nameStr}${alias}  ${chalk.gray(cmd.desc)}`);
    }
    console.log();
  }
  console.log(chalk.gray("  Type any message to chat · Tab autocompletes · Ctrl+D or /exit to quit\n"));
}

// ─── Session summary ──────────────────────────────────────────────────────────

const TOOL_EMOJI_MAP: Record<string, string> = {
  Read: "📖", Write: "✍️", Edit: "✏️", Bash: "🖥️",
  Glob: "🔍", Grep: "🔍", WebFetch: "🌐", WebSearch: "🌐",
  Agent: "🤖", TodoWrite: "📋", NotebookEdit: "📓",
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function printSessionSummary(chat: ChatSession): void {
  const s = chat.getSessionStats();
  if (s.messages === 0 && s.totalTools === 0) {
    // Nothing happened this session — just say bye quietly
    console.log(chalk.gray("\nBye.\n"));
    return;
  }

  const W = 44; // inner width
  const border = "─".repeat(W);
  const line = (left: string, right: string, lv: number, rv: number) => {
    const gap = W - 2 - lv - rv;
    return chalk.dim("│") + " " + left + " ".repeat(Math.max(1, gap)) + right + " " + chalk.dim("│");
  };
  const full = (content: string, cv: number) => {
    const pad = " ".repeat(Math.max(0, W - cv));
    return chalk.dim("│") + content + pad + chalk.dim("│");
  };

  const dur = formatDuration(s.durationMs);
  const msgs = `${s.messages} msg${s.messages !== 1 ? "s" : ""}`;
  const tools = `${s.totalTools} tool${s.totalTools !== 1 ? "s" : ""}`;
  const lines = s.linesChanged > 0 ? `~${s.linesChanged} lines` : "";

  // Tool breakdown: top tools with emoji + count
  const topTools = [...s.toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => {
      const em = TOOL_EMOJI_MAP[name] ?? "🔧";
      return count > 1 ? `${em}×${count}` : em;
    })
    .join("  ");
  const topToolsVisible = topTools.replace(/[\u{1F300}-\u{1FFFF}]/gu, "  ").length;

  const titleText = `  🐝  ${chalk.bold("Session Summary")}`;
  const titleVisible = 2 + 2 + 2 + "Session Summary".length; // emoji=2wide + spaces

  const row1L = `  ⏱  ${chalk.cyan(dur)}`;
  const row1R = `💬 ${chalk.cyan(msgs)}  `;
  const row1Lv = 2 + 3 + dur.length;
  const row1Rv = 2 + msgs.length + 2;

  const row2L = `  🔧 ${chalk.cyan(tools)}`;
  const row2Lv = 2 + 2 + tools.length;
  let row2R = ""; let row2Rv = 0;
  if (lines) { row2R = `✏️  ${chalk.cyan(lines)}  `; row2Rv = 3 + lines.length + 2; }

  const parts: string[] = [
    "",
    chalk.dim(`╭${border}╮`),
    full(titleText, titleVisible),
    chalk.dim(`├${border}┤`),
    line(row1L, row1R, row1Lv, row1Rv),
    ...(row2R ? [line(row2L, row2R, row2Lv, row2Rv)] : [line(row2L, "", row2Lv, 0)]),
  ];

  if (topTools) {
    const toolRow = `  ${topTools}`;
    parts.push(chalk.dim(`├${border}┤`));
    parts.push(full(toolRow, 2 + topToolsVisible));
  }

  parts.push(chalk.dim(`╰${border}╯`), "");
  console.log(parts.join("\n"));
}

// ─── Main REPL ────────────────────────────────────────────────────────────────

export async function runRepl(
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string; config: string },
  iface: rl.Interface
): Promise<void> {
  // ── Layout MUST be initialised before the banner ───────────────────────────
  // ReplLayout sets DECSTBM (scroll region = rows 1..rows-2).  If we print
  // the banner BEFORE setting the scroll region the cursor ends up in the
  // fixed-row area (separator / status), which causes every subsequent write
  // (prompt echo, AI response, line-rewrite) to land in the wrong rows and
  // become invisible or corrupt the fixed rows.
  const status = new StatusLine();
  const layout = new ReplLayout(status);
  layout.init(); // ← reserve bottom 2 rows FIRST

  process.stdout.write(makeBanner(config.provider, config.use_rtk ?? false));
  await showStatus(dirs);

  const PROMPT = "🐝" + chalk.gray(" › ");
  iface.setPrompt(PROMPT);

  // ── Message queue ──────────────────────────────────────────────────────────
  // Chat messages are processed sequentially from a queue so readline never
  // needs to be paused.  This allows the user to submit the next message while
  // the current response is still streaming — it will be processed immediately
  // after.
  const _msgQueue: string[] = [];
  let _queueBusy = false;

  async function drainQueue(): Promise<void> {
    if (_queueBusy) return;
    _queueBusy = true;
    try {
      while (_msgQueue.length > 0) {
        const msg = _msgQueue.shift()!;
        await chatSession.send(msg);
      }
    } finally {
      _queueBusy = false;
      // Redraw the prompt so readline's position tracking is correct
      // after AI output potentially scrolled the terminal.
      layout.refreshStatus();
      iface.setPrompt(PROMPT);
      iface.prompt();
    }
  }

  const chatSession = new ChatSession(config, {
    onStatusUpdate: (msg) => {
      if (msg === null) {
        status.clear(STATUS_PRIORITY.WORKING);
      } else {
        const queued = _msgQueue.length > 0 ? chalk.dim(` · +${_msgQueue.length} queued`) : "";
        status.set(STATUS_PRIORITY.WORKING, `${msg}${queued}`);
      }
      layout.refreshStatus();
    },
  });
  // image placeholder → resolved file path (populated async after clipboard save)
  const imageMap = new Map<string, string>();
  let _clipPoller: ReturnType<typeof setInterval> | undefined;
  let imageSeq = 0;
  let _lastClipSize = 0;

  // ── Multi-line input state ────────────────────────────────────────────────
  const CONT_PROMPT = chalk.dim("  · "); // continuation line prefix
  let _mlBuffer: string[] = []; // accumulated lines before submission
  let _altEnterPending = false; // set in prependListener, consumed in "line" handler
  let _pendingClipImage = false; // true when clipboard has a new unseen image

  // ── Ctrl+C / Ctrl+D double-press state ───────────────────────────────────
  // First press: if line has content → clears it; if empty → no-op.
  // Either way, marks _ctrlExitPending = true.
  // Second press (while pending): closes the interface (exit).
  // Any other keypress resets the pending flag.
  let _ctrlExitPending = false;

  // ── History navigation state ──────────────────────────────────────────────
  // readline stores submitted lines in (iface as any).history[], index 0 = newest.
  // _histIdx = -1 means not browsing; ≥0 means browsing at that index.
  // _histSavedLine preserves the user's in-progress text before entering history.
  // _upPressedOnce: first ↑ on non-empty input moves cursor to start;
  //                 second ↑ (while _upPressedOnce) enters history.
  let _histIdx = -1;
  let _histSavedLine = "";
  let _upPressedOnce = false;

  // ── Low-level line helpers ────────────────────────────────────────────────
  const getLine = (): string =>
    (iface as unknown as { line: string }).line ?? "";
  const getHistory = (): string[] =>
    (iface as unknown as { history: string[] }).history ?? [];

  /** Replace the entire readline input with `text` (cursor ends at rightmost position). */
  function setLine(text: string): void {
    iface.write(null, { ctrl: true, name: "a" }); // cursor → start
    iface.write(null, { ctrl: true, name: "k" }); // kill → end
    if (text) iface.write(text);
  }

  function handleHistoryUp(): void {
    const line = getLine();
    const history = getHistory();
    if (_histIdx === -1) {
      if (line && !_upPressedOnce) {
        // First ↑ on non-empty: jump cursor to start, arm the flag
        iface.write(null, { ctrl: true, name: "a" });
        _upPressedOnce = true;
        return;
      }
      // Second ↑ (armed) or empty input: enter history mode
      if (history.length === 0) { _upPressedOnce = false; return; }
      _histSavedLine = line;
      _histIdx = 0;
      _upPressedOnce = false;
      setLine(history[0]!);
    } else {
      // Already browsing: go to older entry (higher index)
      _upPressedOnce = false;
      if (_histIdx < history.length - 1) {
        _histIdx++;
        setLine(history[_histIdx]!);
      }
      // At oldest entry: stay, don't wrap
    }
  }

  function handleHistoryDown(): void {
    _upPressedOnce = false;
    if (_histIdx === -1) return; // not in history, ↓ does nothing
    if (_histIdx > 0) {
      _histIdx--;
      setLine(getHistory()[_histIdx]!);
    } else {
      // Past most recent: restore original in-progress input
      const saved = _histSavedLine;
      _histIdx = -1;
      _histSavedLine = "";
      setLine(saved);
    }
  }

  // ── Prompt with status header ─────────────────────────────────────────────
  // Status lives in the fixed bottom row managed by ReplLayout.
  // showPrompt() just refreshes that row and calls iface.prompt().
  // No static text is written above the prompt, so readline's cursor tracking
  // is never disturbed and the prompt naturally follows content down the screen.
  function showPrompt(): void {
    const provider = chalk.cyan(config.provider);
    const model = chalk.dim(config.model ?? "default");
    const msgs = chatSession.messageCount;
    const msgsStr = msgs > 0 ? chalk.dim(` · ${msgs} msg${msgs !== 1 ? "s" : ""}`) : "";
    const mlStr = _mlBuffer.length > 0 ? chalk.dim(` · ${_mlBuffer.length + 1} lines`) : "";
    status.set(STATUS_PRIORITY.BASE, `${provider} · ${model}${msgsStr}${mlStr}`);

    if (_pendingClipImage) {
      status.set(STATUS_PRIORITY.CLIPBOARD, "📋 Image in clipboard · Ctrl+V to paste");
    } else {
      status.clear(STATUS_PRIORITY.CLIPBOARD);
    }

    layout.refreshStatus();
    iface.setPrompt(PROMPT);
    iface.prompt();
  }

  // ── stdin data-level interceptor ─────────────────────────────────────────
  // Handles: Ctrl+C/D double-press exit, ↑/↓ history, bracketed paste.
  // Operating at the raw "data" level means readline never sees these bytes,
  // so we have full control without fighting readline's built-in handlers.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?2004h"); // enable bracketed paste mode
    let _pasteMode = false;
    let _pasteBuf = "";
    const _origEmit = process.stdin.emit.bind(process.stdin);
    (process.stdin as unknown as { emit: typeof process.stdin.emit }).emit = function (
      event: string | symbol,
      ...args: unknown[]
    ): boolean {
      if (event === "data") {
        const chunk = args[0] as Buffer;
        const str = chunk.toString("utf8");

        // ── Ctrl+C (\x03) and Ctrl+D (\x04): double-press to exit ──────────
        // First press on empty  → no visible change, arm _ctrlExitPending.
        // First press with text → clear the line, arm _ctrlExitPending.
        // Second press (pending) → close (exit REPL).
        if (str === "\x03" || str === "\x04") {
          const line = getLine();
          if (_ctrlExitPending) {
            iface.close();
          } else if (line) {
            setLine(""); // clear content
            _mlBuffer = [];
            _histIdx = -1;
            _histSavedLine = "";
            _ctrlExitPending = true;
          } else {
            _ctrlExitPending = true; // empty line: just arm, no visible change
          }
          return true; // always swallow — never let readline handle these
        }

        // ── Arrow keys: custom history navigation ────────────────────────────
        if (str === "\x1b[A") { handleHistoryUp();   return true; }
        if (str === "\x1b[B") { handleHistoryDown(); return true; }

        // ── Bracketed paste ──────────────────────────────────────────────────
        if (str.includes("\x1b[200~") || _pasteMode) {
          if (!_pasteMode) { _pasteMode = true; _pasteBuf = ""; }
          _pasteBuf += str.replace("\x1b[200~", "");
          if (_pasteBuf.includes("\x1b[201~")) {
            const normalized = _pasteBuf.replace("\x1b[201~", "").replace(/[\r\n]+/g, " ").trimEnd();
            _pasteMode = false; _pasteBuf = "";
            return (_origEmit as Function)(event, Buffer.from(normalized, "utf8"));
          }
          return true; // swallow raw paste chunks
        }
      }
      return (_origEmit as Function)(event, ...args);
    } as typeof process.stdin.emit;
  }

  // ── Keypress: suggestions + image hint + Ctrl+V paste ────────────────────
  if (process.stdout.isTTY) {
    rl.emitKeypressEvents(process.stdin);

    // prependListener fires BEFORE readline's own handler.
    // No cursor movements here — IME composition is sensitive to them.
    process.stdin.prependListener("keypress", (_char, key) => {
      // Ctrl+V with a pending clipboard image → insert placeholder
      if (key?.ctrl && key?.name === "v" && _pendingClipImage) {
        _pendingClipImage = false;
        imageSeq++;
        const placeholder = `[Image #${imageSeq}]`;
        iface.write(placeholder);
        saveClipboardImage().then((filePath) => {
          if (filePath) imageMap.set(placeholder, filePath);
        });
        return;
      }
      // Alt+Enter → flag as continuation; readline will fire "line" which we intercept
      if (key?.meta && (key?.name === "return" || key?.name === "enter")) {
        _altEnterPending = true;
        return;
      }
    });

    // Show slash suggestions AFTER readline updates rl.line (setImmediate = after
    // readline echoes the char, so IME composition is not disturbed).
    // Also: reset pending-exit and up-pressed flags on any regular keypress.
    process.stdin.on("keypress", (_char, key) => {
      if (!key || key.ctrl || key.name === "return" || key.name === "enter") return;
      setImmediate(() => {
        // Any regular keypress cancels the double-press pending state
        _ctrlExitPending = false;
        // Any non-arrow keypress cancels the "cursor moved to start" arm
        _upPressedOnce = false;
        // If the user edited while in history mode, exit history mode
        if (_histIdx >= 0) {
          const hist = getHistory();
          if (getLine() !== (hist[_histIdx] ?? "")) {
            _histIdx = -1;
            _histSavedLine = "";
          }
        }
        const line = getLine();
        if (line.startsWith("/") && line.length <= 20) {
          showSuggestions(line);
        } else {
          clearSuggestions();
        }
      });
    });

    // ── Clipboard image polling ────────────────────────────────────────────
    ensureScreenshotDir();
    _lastClipSize = clipboardImageSize(); // baseline — don't trigger on existing clipboard
    let _pollBusy = false;

    _clipPoller = setInterval(() => {
      if (_pollBusy) return;
      _pollBusy = true;
      const size = clipboardImageSize();
      _pollBusy = false;

      if (size > 0 && size !== _lastClipSize) {
        _lastClipSize = size;
        _pendingClipImage = true;
        // Status will show the hint on next showPrompt()
        // (updating status display during active readline input is avoided
        //  to prevent cursor corruption)
      } else if (size === 0 && _pendingClipImage) {
        _pendingClipImage = false;
      }
    }, 600);
  }

  // ── Ctrl+D / EOF ─────────────────────────────────────────────────────────
  // Note: Ctrl+C (\x03) and Ctrl+D (\x04) are now fully handled in the
  // stdin data interceptor above. SIGINT will only fire for programmatic
  // signals (external kill -INT), handled here as a safe fallback.
  iface.on("close", () => {
    clearSuggestions();
    if (_clipPoller) clearInterval(_clipPoller);
    if (process.stdout.isTTY) process.stdout.write("\x1b[?2004l"); // disable bracketed paste
    layout.cleanup(); // reset DECSTBM so the shell is clean after exit
    printSessionSummary(chatSession);
    process.exit(0);
  });

  // ── Line handler ─────────────────────────────────────────────────────────
  iface.on("line", async (raw) => {
    clearSuggestions();
    // Submitting a line resets all interaction state
    _ctrlExitPending = false;
    _histIdx = -1;
    _histSavedLine = "";
    _upPressedOnce = false;

    // Alt+Enter → accumulate this line and show continuation prompt
    if (_altEnterPending) {
      _altEnterPending = false;
      _mlBuffer.push(raw);
      iface.setPrompt(CONT_PROMPT);
      iface.prompt();
      return;
    }

    // Join multi-line buffer with current line
    let fullInput = raw;
    if (_mlBuffer.length > 0) {
      fullInput = [..._mlBuffer, raw].join("\n");
      _mlBuffer = [];
    }

    const input = fullInput.trim();

    if (!input) {
      showPrompt();
      return;
    }

    // Rewrite the readline-echoed prompt line as a styled history entry.
    // readline already wrote: "🐝 › <input>\n" and moved to the next line.
    // We go back one line, clear it, and replace with a clean gray "› message".
    if (process.stdout.isTTY) {
      const display = fullInput.includes("\n")
        ? (fullInput.split("\n")[0] ?? "") + " ···"
        : input;
      process.stdout.write(`\x1b[A\x1b[2K${chalk.dim("  › " + display)}\n`);
    }

    if (input.startsWith("/")) {
      // Slash commands: pause while running so readline doesn't interleave
      iface.pause();
      const resolved = resolveCommand(input);
      const [cmd, ...args] = resolved.split(/\s+/);
      const shouldExit = await handleCommand(cmd ?? "", args, config, dirs, chatSession);
      if (shouldExit) {
        iface.close();
        return;
      }
      iface.resume();
      showPrompt();
    } else {
      // Free-form chat → queue and return immediately so readline stays active.
      // The user can keep typing/submitting; messages are processed in order.
      let message = input;
      for (const [placeholder, filePath] of imageMap) {
        if (message.includes(placeholder)) {
          message = message.replaceAll(placeholder, filePath);
          imageMap.delete(placeholder);
        }
      }
      _msgQueue.push(message);
      showPrompt(); // show prompt immediately so user can type next message
      void drainQueue(); // process queue in background (non-blocking)
    }
  });

  showPrompt();

  // Wait for close
  await new Promise<void>((resolve) => {
    iface.once("close", resolve);
  });
}

// ─── Command handler ──────────────────────────────────────────────────────────

async function handleCommand(
  cmd: string,
  args: string[],
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string },
  chat?: ChatSession
): Promise<boolean> {
  switch (cmd) {
    case "help":
      printHelp();
      break;

    case "chat": {
      const sub = args[0];
      if (sub === "clear") {
        chat?.clearHistory();
        console.log(chalk.gray("  Chat history cleared.\n"));
      } else {
        console.log(chalk.gray("  Usage: /chat clear\n"));
      }
      break;
    }

    case "status":
      await showStatus(dirs);
      break;

    case "tasks": {
      const loader = new TaskLoader(dirs.tasks);
      const store = new StateStore(dirs.state);
      const tasks = await loader.loadAll();
      const filter = args.find((_a, i) => args[i - 1] === "--status");
      const filtered = filter ? tasks.filter((t) => t.status === filter) : tasks;

      if (filtered.length === 0) {
        console.log(chalk.gray("  No tasks found.\n"));
        break;
      }
      const stateMap = new Map<string, NonNullable<Awaited<ReturnType<typeof store.load>>>>();
      for (const task of filtered) {
        const state = await store.load(task.task_id);
        if (state) stateMap.set(task.task_id, state);
      }
      printTaskTable(filtered, stateMap);
      console.log();
      break;
    }

    case "run": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const dryRun = args.includes("--dry-run");
      const loop = new AgentLoop(config, dirs);

      // Wire limit-hit callback: prompt user to switch provider
      const onLimitHit = async (provider: string, message: string) => {
        const registry = new ProviderRegistry(config);
        const available = registry.list().filter((p) => p !== provider);
        if (available.length === 0) {
          console.log(chalk.red("\n  No other providers available. Aborting.\n"));
          return null;
        }
        console.log(chalk.yellow(`\n  Provider "${provider}" hit a limit: ${message}`));
        console.log(chalk.bold("  Available providers:"));
        available.forEach((p, i) => console.log(`    ${chalk.cyan(`[${i + 1}]`)} ${p}`));
        process.stdout.write(chalk.bold("  Switch to [1]: "));

        return new Promise<string | null>((resolve) => {
          process.stdin.once("data", (chunk: Buffer) => {
            const n = parseInt(chunk.toString().trim(), 10);
            if (n >= 1 && n <= available.length) {
              resolve(available[n - 1] ?? null);
            } else {
              resolve(available[0] ?? null);
            }
          });
        });
      };

      await loop.run({ taskId, dryRun, verbose: true, onLimitHit });
      if (config.use_rtk) await showRtkGain();
      break;
    }

    case "plan": {
      const specFile = args.find((a) => !a.startsWith("--"));
      if (!specFile) {
        console.log(chalk.red("  Usage: /plan <spec-file>"));
        break;
      }
      const providerArg = args.find((_a, i) => args[i - 1] === "--provider");
      await runPlan(specFile, dirs.tasks, {
        provider: providerArg ?? config.provider,
      });
      break;
    }

    case "verify": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const loader = new TaskLoader(dirs.tasks);
      const verifier = new Verifier();
      const reporter = new VerificationReporter();
      const allTasks = await loader.loadAll();
      const targets = taskId
        ? allTasks.filter((t) => t.task_id === taskId)
        : allTasks;
      for (const task of targets) {
        console.log(chalk.bold(`  Verifying: ${task.task_id}`));
        const summary = await verifier.runAll(task);
        reporter.print(summary);
      }
      break;
    }

    case "resume": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const loader = new TaskLoader(dirs.tasks);
      const allTasks = await loader.loadAll();
      const resumable = taskId
        ? allTasks.filter((t) => t.task_id === taskId)
        : allTasks.filter((t) => !["done", "failed"].includes(t.status));

      if (resumable.length === 0) {
        console.log(chalk.yellow("  No resumable tasks found.\n"));
        break;
      }
      const loop = new AgentLoop(config, dirs);
      for (const task of resumable) {
        await loop.run({ taskId: task.task_id, verbose: true });
      }
      break;
    }

    case "replay": {
      const taskId = args.find((a) => !a.startsWith("--"));
      if (!taskId) {
        console.log(chalk.red("  Usage: /replay <task-id>"));
        break;
      }
      const traceId = args.find((_a, i) => args[i - 1] === "--trace-id");
      await runReplay(dirs.logs, taskId, { traceId });
      break;
    }

    case "provider": {
      const registry = new ProviderRegistry(config);
      const available = registry.list();
      const target = args[0];

      if (target) {
        // /provider <name> — switch directly
        if (!available.includes(target)) {
          console.log(chalk.red(`  Unknown provider: ${target}`));
          console.log(chalk.gray(`  Available: ${available.join(", ")}\n`));
          break;
        }
        const health = await registry.get(target).health();
        if (!health) {
          console.log(chalk.yellow(`  ⚠ "${target}" health check failed — switching anyway.`));
        }
        const sessionStore = new SessionStore(dirs.state);
        await sessionStore.init(config.provider);
        await sessionStore.switchProvider(target, "manual switch");
        config.provider = target;
        const configPath = join(dirs.logs, "..", ".bee", "config.json");
        await writeJsonFile(configPath, config);
        console.log(chalk.green(`\n  ✓ Switched to ${chalk.bold(target)}\n`));
        break;
      }

      // /provider — show info then interactive picker
      console.log(`\n  Model   : ${chalk.cyan(config.model ?? "(default)")}`);
      console.log(`  RTK     : ${config.use_rtk ? chalk.green("enabled") : chalk.gray("disabled")}`);
      console.log(`  Retries : ${config.max_retries}  Timeout : ${config.timeout_ms / 1000}s\n`);

      const currentIdx = Math.max(0, available.indexOf(config.provider));
      const labels = available.map((p) =>
        p === config.provider ? `${p}  ${chalk.green("(active)")}` : p
      );

      const chosen = await interactiveSelect(labels, currentIdx, {
        hint: "↑↓ navigate · Enter select · Esc cancel",
      });

      if (chosen === null || available[chosen] === config.provider) break;

      const newProvider = available[chosen]!;
      const health = await registry.get(newProvider).health();
      if (!health) {
        console.log(chalk.yellow(`  ⚠ "${newProvider}" health check failed — switching anyway.`));
      }
      const sessionStore = new SessionStore(dirs.state);
      await sessionStore.init(config.provider);
      await sessionStore.switchProvider(newProvider, "manual switch");
      config.provider = newProvider;
      const configPath = join(dirs.logs, "..", ".bee", "config.json");
      await writeJsonFile(configPath, config);
      console.log(chalk.green(`  ✓ Switched to ${chalk.bold(newProvider)}\n`));
      break;
    }

    case "switch": {
      const target = args[0];
      const registry = new ProviderRegistry(config);
      const available = registry.list();

      if (!target) {
        console.log(chalk.bold("\n  Available providers:"));
        available.forEach((p, i) => {
          const active = p === config.provider ? chalk.green(" ← active") : "";
          console.log(`    ${chalk.cyan(`[${i + 1}]`)} ${p}${active}`);
        });
        console.log(chalk.gray('\n  Usage: /switch <provider-name>\n'));
        break;
      }

      if (!available.includes(target)) {
        console.log(chalk.red(`  Unknown provider: ${target}. Available: ${available.join(", ")}\n`));
        break;
      }

      // Check health of target provider
      const health = await registry.get(target).health();
      if (!health) {
        console.log(chalk.yellow(`  ⚠ Provider "${target}" may not be available (health check failed).`));
      }

      // Save session context and switch
      const sessionStore = new SessionStore(dirs.state);
      await sessionStore.init(config.provider);
      await sessionStore.switchProvider(target, "manual switch");

      // Persist new provider to config
      config.provider = target;
      const configPath = join(dirs.logs, "..", ".bee", "config.json");
      await writeJsonFile(configPath, config);

      console.log(chalk.green(`\n  ✓ Switched to ${chalk.bold(target)} — session context preserved.\n`));
      break;
    }

    case "session": {
      const sessionStore = new SessionStore(dirs.state);
      const session = await sessionStore.load();
      if (!session) {
        console.log(chalk.gray("  No active session.\n"));
        break;
      }
      console.log(chalk.bold(`\n  Session ${chalk.gray(session.session_id)}`));
      console.log(`  Started   : ${chalk.cyan(new Date(session.started_at).toLocaleString())}`);
      console.log(`  Provider  : ${chalk.cyan(session.active_provider)}\n`);

      console.log(chalk.bold("  Provider usage:"));
      for (const [name, ps] of Object.entries(session.providers)) {
        const active = name === session.active_provider ? chalk.green(" ← active") : "";
        console.log(
          `    ${chalk.cyan(name.padEnd(14))}${active}  ${ps.tokens_used.toLocaleString()} tokens  $${ps.cost_usd.toFixed(4)}`
        );
      }

      if (session.limit_events.length > 0) {
        console.log(chalk.bold("\n  Limit events:"));
        for (const ev of session.limit_events.slice(-5)) {
          const switched = ev.switched_to ? chalk.yellow(` → ${ev.switched_to}`) : "";
          console.log(
            `    ${chalk.red(ev.kind.padEnd(16))} ${chalk.gray(ev.provider)}${switched}  ${chalk.gray(new Date(ev.timestamp).toLocaleTimeString())}`
          );
          console.log(chalk.gray(`      ${ev.message.slice(0, 80)}`));
        }
      }

      if (session.shared_context) {
        console.log(chalk.bold("\n  Shared context:"));
        console.log(chalk.gray(`    ${session.shared_context.slice(0, 200)}`));
      }
      console.log();
      break;
    }

    case "config": {
      const configPath = join(dirs.logs, "..", ".bee", "config.json");
      try {
        const raw = await Bun.file(configPath).text();
        console.log("\n" + chalk.gray(raw) + "\n");
      } catch {
        console.log(chalk.gray("  Config not found.\n"));
      }
      break;
    }

    case "logs": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const tailArg = args.find((_a, i) => args[i - 1] === "--tail");
      const tail = tailArg ? parseInt(tailArg, 10) : 20;

      const allLogs = await listFiles(dirs.logs, ".jsonl");
      const logFiles = allLogs.filter((f) => !f.endsWith("costs.jsonl")).reverse();

      let events: TraceEvent[] = [];
      for (const logFile of logFiles.slice(0, 5)) {
        const fileEvents = await readJsonLines<TraceEvent>(logFile);
        const filtered = taskId
          ? fileEvents.filter((e) => e.task_id === taskId)
          : fileEvents;
        events = [...events, ...filtered];
        if (events.length >= tail) break;
      }

      const recent = events.slice(-tail);
      if (recent.length === 0) {
        console.log(chalk.gray("  No logs found.\n"));
        break;
      }
      console.log(chalk.bold(`\n  Last ${recent.length} events:\n`));
      for (const event of recent) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        console.log(
          `  ${chalk.gray(time)}  ${chalk.cyan(event.kind.padEnd(24))} ${chalk.gray(event.task_id)}`
        );
      }
      console.log();
      break;
    }

    case "gain":
      await showRtkGain();
      break;

    case "clear":
      process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(makeBanner(config.provider, config.use_rtk ?? false));
      break;

    case "exit":
      if (chat) printSessionSummary(chat);
      else console.log(chalk.gray("\nBye.\n"));
      return true;

    default:
      console.log(chalk.red(`  Unknown command: /${cmd}`));
      console.log(chalk.gray('  Type /help to see available commands.\n'));
  }
  return false;
}

// ─── Status dashboard ─────────────────────────────────────────────────────────

async function showStatus(dirs: { tasks: string; state: string }): Promise<void> {
  const loader = new TaskLoader(dirs.tasks);
  const store = new StateStore(dirs.state);
  const tasks = await loader.loadAll();

  if (tasks.length === 0) {
    console.log(chalk.gray('  No tasks yet — run /plan <spec-file> to create one.\n'));
    return;
  }

  const counts: Record<string, number> = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(
    ([s, n]) => `${colorStatus(s)}: ${n}`
  );
  console.log(`  ${parts.join("   ")}\n`);

  const stateMap = new Map<string, NonNullable<Awaited<ReturnType<typeof store.load>>>>();
  for (const task of tasks) {
    const state = await store.load(task.task_id);
    if (state) stateMap.set(task.task_id, state);
  }
  printTaskTable(tasks, stateMap);
  console.log();
}
