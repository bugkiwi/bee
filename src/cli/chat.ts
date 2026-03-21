import chalk from "chalk";
import type { WorkspaceConfig } from "../types/config.ts";
import type { BeeSession, BeeTranscriptLine } from "../session/manager.ts";
import { SessionManager } from "../session/manager.ts";
import type { ToolDiffMeta } from "../types/transcript.ts";
import { createToolDiffPreview } from "../utils/diff-preview.ts";

// ─── Content block types ──────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
}

// ─── Tool emoji + preview ─────────────────────────────────────────────────────

const TOOL_EMOJI: Record<string, string> = {
  Read: "📖",
  Write: "✍️",
  Edit: "✏️",
  Bash: "🖥️",
  Glob: "🔍",
  Grep: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Agent: "🤖",
  TodoWrite: "📋",
  NotebookEdit: "📓",
};

function toolEmoji(name: string): string {
  return TOOL_EMOJI[name] ?? "🔧";
}

function toolPreview(name: string, args: Record<string, unknown>): string {
  const shorten = (s: string, n = 60) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  if ((name === "Read" || name === "Write" || name === "Edit") && args.file_path)
    return shorten(String(args.file_path));
  if (name === "Bash" && args.command)
    return shorten(String(args.command));
  if ((name === "Glob" || name === "Grep") && (args.pattern ?? args.query))
    return shorten(String(args.pattern ?? args.query));
  if (name === "WebFetch" && args.url)
    return shorten(String(args.url));
  if (name === "WebSearch" && args.query)
    return shorten(String(args.query));
  const raw = JSON.stringify(args);
  return shorten(raw);
}

// ─── ToolTracker — in-place single-line tool display ─────────────────────────

interface ToolCall { name: string; preview: string }

export interface ToolTrackerStats {
  count: number;
  toolCounts: Map<string, number>;
  linesChanged: number;
}

interface ToolTrackerOptions {
  write?: (text: string) => void;
  onTool?: (name: string, preview: string) => void;
  onToolDiff?: (meta: ToolDiffMeta) => void;
  onSummary?: (summary: string) => void;
}

class ToolTracker {
  private calls: ToolCall[] = [];
  private _needsNewline = false; // true after a tool line (no trailing \n yet)
  private _linesChanged = 0;

  constructor(private options: ToolTrackerOptions = {}) {}

  private get _renderEnabled(): boolean {
    return typeof this.options.write === "function";
  }

  private write(text: string): void {
    if (this.options.write) this.options.write(text);
  }

  get count(): number { return this.calls.length; }

  /** Call before writing any text — ensures text starts on fresh line after a tool. */
  beforeText(): void {
    if (this._renderEnabled && this._needsNewline) {
      this.write("\n");
      this._needsNewline = false;
    }
  }

  /** Register a tool call and print it as its own line. */
  track(name: string, args: Record<string, unknown>): void {
    const preview = toolPreview(name, args);
    const diffPreview = createToolDiffPreview(name, args);
    this.calls.push({ name, preview });
    this.options.onTool?.(name, preview);
    if (diffPreview) this.options.onToolDiff?.(diffPreview);

    // Estimate lines changed from file-writing tools
    if (name === "Edit" && args.new_string)
      this._linesChanged += String(args.new_string).split("\n").length;
    else if (name === "Write" && args.content)
      this._linesChanged += String(args.content).split("\n").length;

    if (this._renderEnabled) {
      const emoji = toolEmoji(name);
      const line = `\n  ${emoji} ${chalk.cyan(name)}  ${chalk.dim(preview)}`;
      this.write(line);
      this._needsNewline = true;
    }
  }

  /** Finalize display: flush pending newline, print collapsed summary. */
  finish(): void {
    if (this._renderEnabled && this._needsNewline) {
      this.write("\n");
      this._needsNewline = false;
    }
    if (this.calls.length === 0) return;

    const summary = `↳ ${this.calls.length} tool${this.calls.length !== 1 ? "s" : ""}`;
    this.options.onSummary?.(summary);

    if (!this._renderEnabled) return;

    const icons = this.calls.map(c => toolEmoji(c.name)).join(" ");
    this.write(
      chalk.dim(`\n  ↳ ${this.calls.length} tool${this.calls.length !== 1 ? "s" : ""}  ${icons}\n`)
    );
  }

  /** Return aggregated stats for session accumulation. */
  stats(): ToolTrackerStats {
    const toolCounts = new Map<string, number>();
    for (const c of this.calls) {
      toolCounts.set(c.name, (toolCounts.get(c.name) ?? 0) + 1);
    }
    return { count: this.calls.length, toolCounts, linesChanged: this._linesChanged };
  }
}

// ─── Auth error detection ─────────────────────────────────────────────────────

function detectAuthError(stderr: string, provider: string): string | null {
  const s = stderr.toLowerCase();
  if (provider === "claude") {
    if (s.includes("not authenticated") || s.includes("login") || s.includes("auth")) {
      return `  Claude not authenticated. Run: ${chalk.cyan("claude auth login")}`;
    }
  }
  if (provider === "codex") {
    if (s.includes("api key") || s.includes("openai_api_key") || s.includes("unauthorized")) {
      return `  Set your API key: ${chalk.cyan("export OPENAI_API_KEY=sk-...")}`;
    }
  }
  if (provider === "kimi") {
    if (s.includes("api key") || s.includes("moonshot") || s.includes("unauthorized")) {
      return `  Set your API key: ${chalk.cyan("export MOONSHOT_API_KEY=...")}`;
    }
  }
  return null;
}

// ─── In-place emoji spinner ───────────────────────────────────────────────────
// Cycles through frames in-place with \r, no movement track.
const SPIN_FRAMES = ["🌻", "🌸", "🌺", "🌼", "🍯", "🌻"];

function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY) return () => {};
  let i = 0;
  process.stdout.write(`  ${SPIN_FRAMES[0]} ${chalk.gray(label)}`);
  const t = setInterval(() => {
    // \x1b[2K erases the line, \x1b[G moves to column 1 (avoids OCRNL converting \r→\n)
    process.stdout.write(`\x1b[2K\x1b[G  ${SPIN_FRAMES[i++ % SPIN_FRAMES.length]} ${chalk.gray(label)}`);
  }, 500);
  return () => {
    clearInterval(t);
    process.stdout.write("\x1b[2K\x1b[G");
  };
}

// ─── ChatSession ─────────────────────────────────────────────────────────────
//
// Uses provider-native session continuation instead of rebuilding prompts:
//   - Claude: --session-id <uuid>  (Claude CLI maintains conversation)
//   - Codex:  --session-id passed in args (Codex maintains conversation)
//   - Kimi:   --session <id>       (Kimi CLI maintains conversation)
//
// No message history is stored in-process — the provider owns the context.
// This eliminates the O(n) token growth of the old buildPrompt() approach.

export interface SessionStats {
  durationMs: number;
  messages: number;
  totalTools: number;
  toolCounts: Map<string, number>;
  linesChanged: number;
}

export interface ChatRenderHooks {
  onThinkingStart?: (label: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (name: string, preview: string) => void;
  onToolDiff?: (meta: ToolDiffMeta) => void;
  onToolSummary?: (summary: string) => void;
  onText?: (text: string) => void;
  onError?: (text: string) => void;
  /** Fired instead of onText when the response is a plan routing marker */
  onPlanIntent?: (goal: string) => void;
}

const PLAN_INTENT_PREFIX = `[If the following message is a software development task (build, fix, implement, create, add, migrate, refactor, debug, or similar — in ANY human language), respond ONLY with: <bee:plan goal="<concise English goal>"/>. Otherwise respond normally.]

`;

export interface ChatOptions {
  /** Called with a message when the session starts working, null when done. */
  onStatusUpdate?: (message: string | null) => void;
  /** Project root path for session persistence. */
  projectPath?: string;
}

export interface InitSessionOptions {
  /** Resume a specific bee session id. */
  resumeSessionId?: string;
  /** Resume the newest session in current project when no explicit id is given. */
  resumeLatest?: boolean;
}

export class ChatSession {
  private sessionStart = Date.now();
  private totalTools = 0;
  private toolCounts = new Map<string, number>();
  private linesChanged = 0;
  private _messageCount = 0;

  // ── Provider-native session IDs ──────────────────────────────────────────
  // These are the IDs used by each provider's CLI to resume conversations.
  // Allocated lazily on first send to each provider.
  private _claudeSessionId: string | null = null;
  private _codexSessionId: string | null = null;
  private _kimiSessionId: string | null = null;

  // ── Persistent session (optional) ────────────────────────────────────────
  private _sessionManager: SessionManager | null = null;
  private _beeSession: BeeSession | null = null;

  constructor(private config: WorkspaceConfig, private opts: ChatOptions = {}) {
    if (opts.projectPath) {
      this._sessionManager = new SessionManager(opts.projectPath);
    }
  }

  get messageCount(): number {
    return this._messageCount;
  }

  /** Reset native session IDs — starts fresh conversations with all providers. */
  clearHistory(): void {
    this._claudeSessionId = null;
    this._codexSessionId = null;
    this._kimiSessionId = null;
    this._messageCount = 0;
    if (this._beeSession) {
      this._beeSession.messageCount = 0;
      this._beeSession.transcript = [];
      if (this._sessionManager) {
        void this._sessionManager.resetConversation(this._beeSession);
      }
    }
  }

  /** Get the current bee session (if persisted). */
  get beeSession(): BeeSession | null {
    return this._beeSession;
  }

  get transcript(): BeeTranscriptLine[] {
    return this._beeSession?.transcript ?? [];
  }

  async appendTranscript(
    lines: Array<Pick<BeeTranscriptLine, "type" | "text" | "meta">>
  ): Promise<void> {
    if (!this._sessionManager || !this._beeSession || lines.length === 0) return;
    const now = new Date().toISOString();
    const stamped: BeeTranscriptLine[] = lines.map((line) => ({
      type: line.type,
      text: line.text,
      ...(line.meta ? { meta: line.meta } : {}),
      at: now,
    }));
    await this._sessionManager.appendTranscript(this._beeSession, stamped);
  }

  /** Switch active provider for both runtime config and persisted bee session. */
  async switchProvider(to: string): Promise<void> {
    this.config.provider = to;
    if (this._sessionManager && this._beeSession) {
      await this._sessionManager.switchProvider(this._beeSession, to);
      return;
    }
    if (this._beeSession) {
      this._beeSession.activeProvider = to;
    }
  }

  /** Initialize or resume a persistent session. Call once after construction. */
  async initSession(opts: InitSessionOptions = {}): Promise<BeeSession> {
    const { resumeSessionId, resumeLatest = false } = opts;
    if (!this._sessionManager) {
      this._sessionManager = new SessionManager(this.opts.projectPath ?? process.cwd());
    }
    let existing: BeeSession | null = null;
    if (resumeSessionId) {
      existing = await this._sessionManager.load(resumeSessionId);
      if (!existing) {
        const prefixMatches = (await this._sessionManager.list())
          .filter((session) => session.id.startsWith(resumeSessionId));

        if (prefixMatches.length === 1) {
          existing = prefixMatches[0]!;
        } else if (prefixMatches.length > 1) {
          const sample = prefixMatches
            .slice(0, 5)
            .map((session) => session.id.slice(0, 12))
            .join(", ");
          throw new Error(
            `Ambiguous session prefix "${resumeSessionId}" (${prefixMatches.length} matches: ${sample}${prefixMatches.length > 5 ? ", ..." : ""}). Use a longer id.`
          );
        } else {
          throw new Error(`Session not found in current project: ${resumeSessionId}`);
        }
      }
    } else if (resumeLatest) {
      existing = await this._sessionManager.loadLatest();
    }

    if (existing) {
      this._beeSession = existing;
      // Restore native session IDs from persisted bindings
      for (const [name, binding] of Object.entries(existing.providers)) {
        if (binding.nativeId) {
          if (name === "claude") this._claudeSessionId = binding.nativeId;
          else if (name === "codex") this._codexSessionId = binding.nativeId;
          else if (name === "kimi") this._kimiSessionId = binding.nativeId;
        }
      }
      this._messageCount = existing.messageCount;
      if (existing.activeProvider) {
        this.config.provider = existing.activeProvider;
      }
      return existing;
    }
    // Create new session
    this._beeSession = await this._sessionManager.create(this.config.provider);
    return this._beeSession;
  }

  private accumulateStats(s: ToolTrackerStats): void {
    this.totalTools += s.count;
    this.linesChanged += s.linesChanged;
    for (const [name, count] of s.toolCounts) {
      this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + count);
    }
  }

  getSessionStats(): SessionStats {
    return {
      durationMs: Date.now() - this.sessionStart,
      messages: this._messageCount,
      totalTools: this.totalTools,
      toolCounts: this.toolCounts,
      linesChanged: this.linesChanged,
    };
  }

  /**
   * Send a user message to the configured provider and stream the response.
   * Uses provider-native session continuation — no prompt rebuilding.
   */
  async send(userMessage: string, hooks?: ChatRenderHooks): Promise<void> {
    const eventMode = Boolean(hooks);
    this._messageCount++;
    this.opts.onStatusUpdate?.("thinking…");
    if (!eventMode) {
      console.log(); // blank line before response
    } else {
      hooks?.onThinkingStart?.("thinking…");
    }

    try {
      switch (this.config.provider) {
        case "claude":
          await this.sendClaude(userMessage, hooks);
          break;
        case "codex":
          await this.sendCodex(userMessage, hooks);
          break;
        case "kimi":
          await this.sendKimi(userMessage, hooks);
          break;
        default:
          await this.sendClaude(userMessage, hooks);
      }
    } catch (err) {
      const errorText = `Error: ${String(err)}`;
      if (eventMode) {
        hooks?.onError?.(errorText);
      } else {
        console.error(chalk.red(`  ${errorText}\n`));
      }
      this._messageCount--;
      return;
    } finally {
      this.opts.onStatusUpdate?.(null);
    }

    // Persist session state (non-blocking)
    if (this._sessionManager && this._beeSession) {
      void this._sessionManager.recordMessage(this._beeSession);
    }

    if (!eventMode) {
      console.log(); // blank line after response
    }
  }

  // ── Claude ─────────────────────────────────────────────────────────────────
  // Uses --session-id to maintain conversation natively.
  // First call: generates a UUID for the session.
  // Subsequent calls: --resume <session-id> continues the conversation.

  private async sendClaude(userMessage: string, hooks?: ChatRenderHooks): Promise<string> {
    const model = this.config.model ?? "claude-sonnet-4-6";

    // Allocate a native session ID on first call
    const isFirstMessage = this._claudeSessionId === null;
    if (isFirstMessage) {
      this._claudeSessionId = crypto.randomUUID();
    }

    const eventMode = Boolean(hooks);
    const stopSpinner = eventMode ? (() => {}) : startSpinner("thinking…");
    let spinnerStopped = false;
    const tracker = new ToolTracker({
      write: eventMode ? undefined : (text) => process.stdout.write(text),
      onTool: (name, preview) => hooks?.onTool?.(name, preview),
      onToolDiff: (meta) => hooks?.onToolDiff?.(meta),
      onSummary: (summary) => hooks?.onToolSummary?.(summary),
    });

    // Build args: first message uses --session-id, subsequent use --resume
    const args = [
      "claude",
      "--dangerously-skip-permissions",
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
    ];

    if (isFirstMessage) {
      // First message: establish a new session with this ID
      args.push("--session-id", this._claudeSessionId!);
    } else {
      // Subsequent messages: resume the existing session
      args.push("--resume", this._claudeSessionId!);
    }

    // Prompt goes via stdin (edit mode); prepend classifier so LLM can route to plan flow
    const proc = Bun.spawn(args, {
      stdin: new Blob([PLAN_INTENT_PREFIX + userMessage]),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Persist native ID to bee session
    if (this._sessionManager && this._beeSession && isFirstMessage) {
      void this._sessionManager.bindNativeId(this._beeSession, "claude", this._claudeSessionId!);
    }

    // Drain stderr concurrently to prevent buffer deadlock
    const stderrProm = new Response(proc.stderr).text().catch(() => "");

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buf = "";

    function stopOnce() {
      if (!spinnerStopped) { stopSpinner(); spinnerStopped = true; }
    }

    // Plan-intent detection: if LLM responds with <bee:plan goal="..."/>, suppress
    // onText and fire onPlanIntent instead — detected on first text chunk.
    let planMarkerDetected = false;
    let firstTextSeen = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Process every complete newline-delimited JSON line
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: {
            type?: string;
            session_id?: string;
            message?: { content?: ContentBlock[] };
            result?: string;
            name?: string;
            input?: Record<string, unknown>;
          };
          try { ev = JSON.parse(trimmed); } catch { continue; }

          if (ev.type === "system") {
            // Claude emits session_id in the system init event
            if (ev.session_id && !this._claudeSessionId) {
              this._claudeSessionId = ev.session_id;
            }
            continue;
          }
          stopOnce();

          if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
            for (const block of ev.message!.content!) {
              if (block.type === "text" && block.text) {
                fullText += block.text;
                if (!firstTextSeen) {
                  firstTextSeen = true;
                  if (fullText.trimStart().startsWith("<bee:plan")) {
                    planMarkerDetected = true;
                  }
                }
                if (planMarkerDetected) continue;
                tracker.beforeText();
                if (eventMode) {
                  hooks?.onText?.(block.text);
                } else {
                  process.stdout.write(block.text);
                }
              } else if (block.type === "tool_use") {
                tracker.track(block.name ?? "", block.input ?? {});
              } else if (block.type === "thinking") {
                const excerpt = (block.thinking ?? "").trim().slice(0, 160);
                if (!excerpt) continue;
                if (eventMode) {
                  hooks?.onThinking?.(excerpt);
                } else {
                  tracker.beforeText();
                  process.stdout.write(
                    chalk.dim(`\n  💭  ${excerpt}${excerpt.length === 160 ? "…" : ""}\n`)
                  );
                }
              }
            }
          } else if (ev.type === "tool_use") {
            // Top-level tool_use event (emitted between assistant turns)
            tracker.track(ev.name ?? "", ev.input ?? {});
          } else if (ev.type === "result" && ev.result && !fullText.trim()) {
            tracker.beforeText();
            if (eventMode) {
              hooks?.onText?.(ev.result);
            } else {
              process.stdout.write(ev.result);
            }
            fullText = ev.result;
          }
        }
      }
    } finally {
      reader.releaseLock();
      stopOnce();
      tracker.finish();
      this.accumulateStats(tracker.stats());
    }

    await proc.exited;
    const stderrText = await stderrProm;

    const authErr = detectAuthError(stderrText, "claude");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim() && !fullText.trim()) {
      throw new Error(stderrText.trim());
    }

    if (planMarkerDetected && eventMode) {
      const match = fullText.trim().match(/^<bee:plan\s+goal="([^"]+)"\s*\/?>/);
      if (match) hooks?.onPlanIntent?.(match[1]!);
    }

    return fullText.trim();
  }

  // ── Codex ──────────────────────────────────────────────────────────────────
  // Uses `codex resume <session-id> <prompt>` for continuation.

  private async sendCodex(userMessage: string, hooks?: ChatRenderHooks): Promise<string> {
    const eventMode = Boolean(hooks);
    const stopSpinner = eventMode ? (() => {}) : startSpinner("thinking…");

    let args: string[];
    if (this._codexSessionId) {
      // Resume existing conversation
      args = ["codex", "resume", this._codexSessionId, userMessage];
    } else {
      // New conversation
      args = ["codex", "--quiet", userMessage];
    }

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    stopSpinner();
    await proc.exited;

    // Try to capture session ID from codex output/stderr for future resumption
    const stderrText = await new Response(proc.stderr).text().catch(() => "");

    // Codex prints session info to stderr; try to extract session ID
    if (!this._codexSessionId) {
      const match = stderrText.match(/session[_\s]?id[:\s]+([a-f0-9-]+)/i)
        ?? text.match(/session[_\s]?id[:\s]+([a-f0-9-]+)/i);
      if (match) {
        this._codexSessionId = match[1]!;
        if (this._sessionManager && this._beeSession) {
          void this._sessionManager.bindNativeId(this._beeSession, "codex", this._codexSessionId);
        }
      }
    }

    const authErr = detectAuthError(stderrText, "codex");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim()) throw new Error(stderrText.trim());

    const trimmed = text.trim();
    if (trimmed) {
      if (eventMode) hooks?.onText?.(trimmed);
      else process.stdout.write(trimmed);
    }
    return trimmed;
  }

  // ── Kimi ───────────────────────────────────────────────────────────────────
  // Uses --session <id> for conversation continuation.
  // First call: let Kimi allocate a session, capture from output.
  // Subsequent calls: --session <id> resumes.

  private async sendKimi(userMessage: string, hooks?: ChatRenderHooks): Promise<string> {
    const eventMode = Boolean(hooks);
    const stopSpinner = eventMode ? (() => {}) : startSpinner("thinking…");

    const args = ["kimi", "--print", userMessage];
    if (this._kimiSessionId) {
      // Resume existing session
      args.splice(1, 0, "--session", this._kimiSessionId);
    }

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let firstChunk = true;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        if (firstChunk) { stopSpinner(); firstChunk = false; }
        if (eventMode) hooks?.onText?.(chunk);
        else process.stdout.write(chunk);
        fullText += chunk;
      }
    } finally {
      reader.releaseLock();
      stopSpinner();
    }

    await proc.exited;

    const stderrText = await new Response(proc.stderr).text().catch(() => "");

    // Capture Kimi session ID from stderr for future continuation
    if (!this._kimiSessionId) {
      const match = stderrText.match(/session[_\s]?(?:id)?[:\s]+([a-f0-9-]+)/i);
      if (match) {
        this._kimiSessionId = match[1]!;
        if (this._sessionManager && this._beeSession) {
          void this._sessionManager.bindNativeId(this._beeSession, "kimi", this._kimiSessionId);
        }
      }
    }

    const authErr = detectAuthError(stderrText, "kimi");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim()) throw new Error(stderrText.trim());

    return fullText.trim();
  }
}
