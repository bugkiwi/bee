import chalk from "chalk";
import type { WorkspaceConfig } from "../types/config.ts";

// ─── Content block types ──────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── In-place emoji spinner ───────────────────────────────────────────────────
// Cycles through frames in-place with \r, no movement track.
const SPIN_FRAMES = ["🐝", "🌸", "🍯", "🐝"];

function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY) return () => {};
  let i = 0;
  const t = setInterval(() => {
    process.stdout.write(`\r  ${SPIN_FRAMES[i++ % SPIN_FRAMES.length]} ${chalk.gray(label)}`);
  }, 500);
  return () => {
    clearInterval(t);
    process.stdout.write("\r\x1b[2K");
  };
}

// ─── ChatSession ─────────────────────────────────────────────────────────────

export class ChatSession {
  private history: ChatMessage[] = [];

  constructor(private config: WorkspaceConfig) {}

  get messageCount(): number {
    return this.history.length;
  }

  clearHistory(): void {
    this.history = [];
  }

  /**
   * Send a user message to the configured provider and stream the response.
   * Returns the assistant's reply, or null on error.
   */
  async send(userMessage: string): Promise<void> {
    this.history.push({ role: "user", content: userMessage });

    console.log(); // blank line before response

    let reply: string | null = null;

    try {
      switch (this.config.provider) {
        case "claude":
          reply = await this.sendClaude(userMessage);
          break;
        case "codex":
          reply = await this.sendCodex(userMessage);
          break;
        case "kimi":
          reply = await this.sendKimi(userMessage);
          break;
        default:
          reply = await this.sendClaude(userMessage);
      }
    } catch (err) {
      console.error(chalk.red(`  Error: ${String(err)}\n`));
      this.history.pop(); // remove failed user message
      return;
    }

    if (reply !== null) {
      this.history.push({ role: "assistant", content: reply });
    }

    console.log(); // blank line after response
  }

  // ── Claude ─────────────────────────────────────────────────────────────────

  private async sendClaude(userMessage: string): Promise<string> {
    const prompt = this.buildPrompt(userMessage);
    const model = this.config.model ?? "claude-sonnet-4-6";

    const stopSpinner = startSpinner("thinking…");
    let spinnerStopped = false;

    // Mirror ClaudeProvider edit-mode: prompt via stdin, stream-json events,
    // --dangerously-skip-permissions so Claude can use file-editing tools.
    const proc = Bun.spawn(
      ["claude", "--dangerously-skip-permissions", "--model", model, "--output-format", "stream-json"],
      { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" }
    );

    // Drain stderr concurrently to prevent buffer deadlock
    const stderrProm = new Response(proc.stderr).text().catch(() => "");

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buf = "";

    function stopOnce() {
      if (!spinnerStopped) { stopSpinner(); spinnerStopped = true; }
    }

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
            message?: { content?: ContentBlock[] };
            result?: string;
            name?: string;
            input?: Record<string, unknown>;
          };
          try { ev = JSON.parse(trimmed); } catch { continue; }

          if (ev.type === "system") continue; // skip init handshake
          stopOnce();

          if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
            for (const block of ev.message!.content!) {
              if (block.type === "text" && block.text) {
                process.stdout.write(block.text);
                fullText += block.text;
              } else if (block.type === "tool_use") {
                process.stdout.write(
                  chalk.dim(`\n  🔧 ${chalk.cyan(block.name ?? "")}  ${chalk.gray(JSON.stringify(block.input ?? {}).slice(0, 120))}\n`)
                );
              } else if (block.type === "thinking") {
                process.stdout.write(
                  chalk.dim(`\n  💭 ${(block.thinking ?? "").slice(0, 200)}\n`)
                );
              }
            }
          } else if (ev.type === "tool_use") {
            // Top-level tool_use event (emitted between assistant turns)
            process.stdout.write(
              chalk.dim(`\n  🔧 ${chalk.cyan(ev.name ?? "")}  ${chalk.gray(JSON.stringify(ev.input ?? {}).slice(0, 120))}\n`)
            );
          } else if (ev.type === "result" && ev.result && !fullText.trim()) {
            process.stdout.write(ev.result);
            fullText = ev.result;
          }
        }
      }
    } finally {
      reader.releaseLock();
      stopOnce();
    }

    await proc.exited;
    const stderrText = await stderrProm;

    const authErr = detectAuthError(stderrText, "claude");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim() && !fullText.trim()) {
      throw new Error(stderrText.trim());
    }

    return fullText.trim();
  }

  // ── Codex ──────────────────────────────────────────────────────────────────

  private async sendCodex(userMessage: string): Promise<string> {
    const stopSpinner = startSpinner("thinking…");

    const proc = Bun.spawn(["codex", "--quiet", userMessage], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    stopSpinner();
    await proc.exited;

    const stderrText = await new Response(proc.stderr).text().catch(() => "");
    const authErr = detectAuthError(stderrText, "codex");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim()) throw new Error(stderrText.trim());

    const trimmed = text.trim();
    if (trimmed) process.stdout.write(trimmed);
    return trimmed;
  }

  // ── Kimi ───────────────────────────────────────────────────────────────────

  private async sendKimi(userMessage: string): Promise<string> {
    const prompt = this.buildPrompt(userMessage);
    const stopSpinner = startSpinner("thinking…");

    const proc = Bun.spawn(["kimi", "--print", prompt], {
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
        process.stdout.write(chunk);
        fullText += chunk;
      }
    } finally {
      reader.releaseLock();
      stopSpinner();
    }

    await proc.exited;

    const stderrText = await new Response(proc.stderr).text().catch(() => "");
    const authErr = detectAuthError(stderrText, "kimi");
    if (authErr) throw new Error(authErr);
    if (proc.exitCode !== 0 && stderrText.trim()) throw new Error(stderrText.trim());

    return fullText.trim();
  }

  // ── Conversation history formatting ────────────────────────────────────────

  /**
   * Build a multi-turn prompt for providers that don't natively support
   * message arrays (claude/codex CLI).
   */
  private buildPrompt(currentUserMessage: string): string {
    // Single-turn: just send the message directly
    if (this.history.length <= 1) return currentUserMessage;

    // Multi-turn: include up to last 10 turns as context
    const context = this.history.slice(Math.max(0, this.history.length - 11), -1);
    const lines: string[] = [];
    for (const msg of context) {
      const speaker = msg.role === "user" ? "Human" : "Assistant";
      lines.push(`${speaker}: ${msg.content}`);
    }
    lines.push(`Human: ${currentUserMessage}`);
    lines.push("Assistant:");
    return lines.join("\n\n");
  }
}
