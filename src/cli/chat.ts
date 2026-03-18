import chalk from "chalk";
import type { WorkspaceConfig } from "../types/config.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY) return () => {};
  let i = 0;
  const t = setInterval(() => {
    process.stdout.write(`\r  ${chalk.gray(SPIN_FRAMES[i++ % SPIN_FRAMES.length])} ${chalk.gray(label)}`);
  }, 80);
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

    const proc = Bun.spawn(
      ["claude", "--print", "--model", model, prompt],
      { stdout: "pipe", stderr: "pipe" }
    );

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
        if (firstChunk) {
          stopSpinner();
          firstChunk = false;
        }
        process.stdout.write(chunk);
        fullText += chunk;
      }
    } finally {
      reader.releaseLock();
      stopSpinner();
    }

    await proc.exited;

    // If nothing came from stdout, check stderr for error
    if (!fullText.trim()) {
      const errText = await new Response(proc.stderr).text().catch(() => "");
      if (errText.trim()) {
        console.error(chalk.red(`\n  ${errText.trim()}`));
      }
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
