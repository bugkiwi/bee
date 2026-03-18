import { BaseProvider } from "../base.ts";
import type { ProviderEvent, ProviderResult, StreamCallback } from "../../types/provider.ts";
import type { Task } from "../../types/task.ts";
import { buildPrompt } from "../../utils/prompt.ts";
import { withTimeout } from "../../utils/timeout.ts";
import { parseClaudeStream } from "./parser.ts";
import { wrapWithRtk } from "../../plugins/rtk.ts";
import { readLines } from "../../utils/stream.ts";

export class ClaudeProvider extends BaseProvider {
  readonly name = "claude";
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly useRtk: boolean;
  private readonly editMode: boolean;
  private activeProc: ReturnType<typeof Bun.spawn> | null = null;

  constructor(opts: { model?: string; timeoutMs?: number; useRtk?: boolean; editMode?: boolean } = {}) {
    super();
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.useRtk = opts.useRtk ?? false;
    this.editMode = opts.editMode ?? true;
  }

  async execute(task: Task, _traceId: string, onEvent?: StreamCallback): Promise<ProviderResult> {
    const prompt = buildPrompt(task);
    const workDir = task.working_dir ?? process.cwd();

    let baseArgs: string[];
    if (this.editMode) {
      // Edit mode: prompt via stdin, Claude can use file-editing tools
      baseArgs = [
        "claude",
        "--dangerously-skip-permissions",
        "--model",
        this.model,
        "--output-format",
        "stream-json",
      ];
    } else {
      baseArgs = [
        "claude",
        "--print",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--model",
        this.model,
        prompt,
      ];
    }

    const args = await wrapWithRtk(baseArgs, this.useRtk);
    const runPromise = this.runSubprocess(args, workDir, prompt, onEvent);
    return withTimeout(runPromise, this.timeoutMs, () => {
      this.activeProc?.kill();
    });
  }

  private async runSubprocess(
    args: string[],
    cwd: string,
    prompt: string,
    onEvent?: StreamCallback
  ): Promise<ProviderResult> {
    try {
      const proc = Bun.spawn(args, {
        cwd,
        stdin: this.editMode ? new Blob([prompt]) : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });
      this.activeProc = proc;

      const lines = await readLines(proc.stdout, (line) => {
        onEvent?.(parseClaudeLine(line, this.name));
      });

      const stderrText = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      this.activeProc = null;

      if (exitCode !== 0 && lines.length === 0) {
        return {
          success: false,
          output: stderrText,
          error: `Claude exited with code ${exitCode}: ${stderrText.slice(0, 500)}`,
        };
      }

      if (this.editMode) {
        return { success: exitCode === 0, output: lines.join("\n").trim() };
      }

      const result = parseClaudeStream(lines);
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
      const proc = Bun.spawn(["claude", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      return code === 0;
    } catch {
      return false;
    }
  }
}

function parseClaudeLine(raw: string, provider: string): ProviderEvent {
  const timestamp = new Date().toISOString();
  try {
    const parsed = JSON.parse(raw) as { type?: string };
    const type =
      parsed.type === "assistant" ? "text" :
      parsed.type === "tool_use" ? "tool_use" :
      parsed.type === "result" ? "result" :
      parsed.type === "error" ? "error" :
      parsed.type === "system" ? "system" :
      "line";
    return { provider, type, raw, parsed, timestamp };
  } catch {
    return { provider, type: "line", raw, timestamp };
  }
}
