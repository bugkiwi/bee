import { BaseProvider } from "../base.ts";
import type { ProviderEvent, ProviderResult, StreamCallback } from "../../types/provider.ts";
import type { Task } from "../../types/task.ts";
import { buildPrompt } from "../../utils/prompt.ts";
import { withTimeout } from "../../utils/timeout.ts";
import { parseCodexStream } from "./parser.ts";
import { wrapWithRtk } from "../../plugins/rtk.ts";
import { readLines } from "../../utils/stream.ts";

export class CodexProvider extends BaseProvider {
  readonly name = "codex";
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly useRtk: boolean;
  private activeProc: ReturnType<typeof Bun.spawn> | null = null;

  constructor(opts: { model?: string; timeoutMs?: number; useRtk?: boolean } = {}) {
    super();
    this.model = opts.model ?? "codex-mini-latest";
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.useRtk = opts.useRtk ?? false;
  }

  async execute(task: Task, _traceId: string, onEvent?: StreamCallback): Promise<ProviderResult> {
    const prompt = buildPrompt(task);
    const workDir = task.working_dir ?? process.cwd();

    const baseArgs = [
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      this.model,
      prompt,
    ];
    const args = await wrapWithRtk(baseArgs, this.useRtk);

    const runPromise = this.runSubprocess(args, workDir, onEvent);
    return withTimeout(runPromise, this.timeoutMs, () => {
      this.activeProc?.kill();
    });
  }

  private async runSubprocess(
    args: string[],
    cwd: string,
    onEvent?: StreamCallback
  ): Promise<ProviderResult> {
    try {
      const proc = Bun.spawn(args, {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      this.activeProc = proc;

      const lines = await readLines(proc.stdout, (line) => {
        onEvent?.(parseCodexLine(line, this.name));
      });

      const stderrText = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      this.activeProc = null;

      if (exitCode !== 0 && lines.length === 0) {
        return {
          success: false,
          output: stderrText,
          error: `Codex exited with code ${exitCode}: ${stderrText.slice(0, 500)}`,
        };
      }

      const result = parseCodexStream(lines);
      if (!result.output && lines.length > 0) {
        result.output = lines.join("\n").trim();
      }
      return result;
    } catch (err) {
      return this.makeError(String(err));
    }
  }

  async cancel(_runId: string): Promise<void> {
    this.activeProc?.kill();
    this.activeProc = null;
  }

  async health(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["codex", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}

function parseCodexLine(raw: string, provider: string): ProviderEvent {
  const timestamp = new Date().toISOString();
  try {
    const parsed = JSON.parse(raw) as { type?: string; error?: string };
    const type =
      parsed.type === "error" || parsed.error ? "error" :
      parsed.type === "result" ? "result" :
      "line";
    return { provider, type, raw, parsed, timestamp };
  } catch {
    return { provider, type: "line", raw, timestamp };
  }
}
