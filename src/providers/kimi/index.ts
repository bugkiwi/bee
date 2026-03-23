import { BaseProvider } from "../base.ts";
import type { ProviderResult, StreamCallback } from "../../types/provider.ts";
import type { AgentTask as Task } from "../../types/task.ts";
import { buildPrompt } from "../../utils/prompt.ts";
import { withTimeout } from "../../utils/timeout.ts";
import { wrapWithRtk } from "../../plugins/rtk.ts";
import { readLines } from "../../utils/stream.ts";

export class KimiProvider extends BaseProvider {
  readonly name = "kimi";
  private readonly timeoutMs: number;
  private readonly useRtk: boolean;
  private activeProc: ReturnType<typeof Bun.spawn> | null = null;

  constructor(opts: { timeoutMs?: number; useRtk?: boolean } = {}) {
    super();
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.useRtk = opts.useRtk ?? false;
  }

  async execute(task: Task, _traceId: string, onEvent?: StreamCallback): Promise<ProviderResult> {
    const prompt = buildPrompt(task);
    const workDir = task.working_dir ?? process.cwd();
    const baseArgs = ["kimi", "--print", prompt];
    const args = await wrapWithRtk(baseArgs, this.useRtk);
    const run = this.runSubprocess(args, workDir, onEvent);
    return withTimeout(run, this.timeoutMs, () => { this.activeProc?.kill(); });
  }

  private async runSubprocess(args: string[], cwd: string, onEvent?: StreamCallback): Promise<ProviderResult> {
    try {
      const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
      this.activeProc = proc;

      const lines = await readLines(proc.stdout, (line) => {
        onEvent?.({ provider: this.name, type: "line", raw: line, timestamp: new Date().toISOString() });
      });

      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      this.activeProc = null;

      if (exitCode !== 0 && lines.length === 0) {
        return { success: false, output: stderr, error: `kimi exited ${exitCode}: ${stderr.slice(0, 500)}` };
      }
      return { success: true, output: lines.join("\n").trim() };
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
      const proc = Bun.spawn(["kimi", "--version"], { stdout: "pipe", stderr: "pipe" });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}

