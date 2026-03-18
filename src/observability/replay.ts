import type { TraceEvent } from "../types/observability.ts";
import { readJsonLines } from "../utils/fs.ts";
import chalk from "chalk";

export class ReplayReader {
  constructor(private readonly logFile: string) {}

  async readEvents(opts?: { from?: string; to?: string }): Promise<TraceEvent[]> {
    const events = await readJsonLines<TraceEvent>(this.logFile);
    return events.filter((e) => {
      if (opts?.from && e.timestamp < opts.from) return false;
      if (opts?.to && e.timestamp > opts.to) return false;
      return true;
    });
  }

  async replay(opts?: { from?: string; to?: string }): Promise<void> {
    const events = await this.readEvents(opts);
    if (events.length === 0) {
      console.log(chalk.yellow("No events found in log."));
      return;
    }

    console.log(chalk.bold(`\nReplaying ${events.length} events\n`));

    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const duration = event.duration_ms ? chalk.gray(` (${event.duration_ms}ms)`) : "";
      const data = event.data
        ? chalk.gray("\n  " + JSON.stringify(event.data, null, 2).replace(/\n/g, "\n  "))
        : "";
      console.log(`${chalk.gray(time)} ${chalk.cyan(event.kind)}${duration}${data}`);
    }

    console.log(chalk.bold("\nReplay complete.\n"));
  }
}
