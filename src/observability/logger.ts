import { join } from "node:path";
import type { TraceEvent } from "../types/observability.ts";
import { appendJsonLine } from "../utils/fs.ts";
import chalk from "chalk";

const KIND_COLORS: Record<string, (s: string) => string> = {
  "task.start": chalk.cyan,
  "task.complete": chalk.green,
  "task.fail": chalk.red,
  "step.start": chalk.blue,
  "step.complete": chalk.green,
  "step.fail": chalk.red,
  "provider.request": chalk.yellow,
  "provider.response": chalk.yellow,
  "verify.start": chalk.magenta,
  "verify.pass": chalk.green,
  "verify.fail": chalk.red,
  "retry.attempt": chalk.yellow,
  "state.transition": chalk.gray,
};

export class Logger {
  private readonly logFile: string;
  private readonly verbose: boolean;

  constructor(logDir: string, traceId: string, verbose = false) {
    this.logFile = join(logDir, `${traceId}.jsonl`);
    this.verbose = verbose;
  }

  async log(event: TraceEvent): Promise<void> {
    await appendJsonLine(this.logFile, event);
    if (this.verbose) {
      this.printEvent(event);
    }
  }

  printEvent(event: TraceEvent): void {
    const colorFn = KIND_COLORS[event.kind] ?? chalk.white;
    const time = new Date(event.timestamp).toLocaleTimeString();
    const duration = event.duration_ms ? ` (${event.duration_ms}ms)` : "";
    const data = event.data ? ` ${JSON.stringify(event.data)}` : "";
    console.error(
      `${chalk.gray(time)} ${colorFn(event.kind)}${duration}${data}`
    );
  }

  logFilePath(): string {
    return this.logFile;
  }
}
