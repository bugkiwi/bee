import { join } from "node:path";
import { existsSync } from "node:fs";
import { listFiles } from "../../utils/fs.ts";
import { ReplayReader } from "../../observability/replay.ts";
import { printHeader } from "../output.ts";
import chalk from "chalk";

export interface ReplayOptions {
  traceId?: string;
  from?: string;
  to?: string;
}

export async function runReplay(
  logsDir: string,
  taskId: string,
  opts: ReplayOptions = {}
): Promise<void> {
  printHeader("Replay");

  let logFile: string;

  if (opts.traceId) {
    logFile = join(logsDir, `${opts.traceId}.jsonl`);
  } else {
    // Find the most recent log for this task
    const allLogs = await listFiles(logsDir, ".jsonl");
    const taskLogs = allLogs.filter((f) => !f.endsWith("costs.jsonl"));

    // Find logs that contain events for this task
    // By convention, read each and check
    let found: string | undefined;
    for (const logPath of taskLogs.reverse()) {
      try {
        const text = await Bun.file(logPath).text();
        if (text.includes(`"task_id":"${taskId}"`) || text.includes(`"task_id": "${taskId}"`)) {
          found = logPath;
          break;
        }
      } catch {}
    }

    if (!found) {
      console.error(chalk.red(`No log found for task: ${taskId}`));
      process.exit(1);
    }
    logFile = found;
  }

  if (!existsSync(logFile)) {
    console.error(chalk.red(`Log file not found: ${logFile}`));
    process.exit(1);
  }

  console.log(chalk.gray(`Replaying: ${logFile}\n`));
  const reader = new ReplayReader(logFile);
  await reader.replay(opts);
}
