import chalk from "chalk";
import Table from "cli-table3";
import type { AgentTask as Task } from "../types/task.ts";
import type { StateFile } from "../types/state.ts";

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pending: chalk.gray,
  running: chalk.blue,
  verifying: chalk.magenta,
  done: chalk.green,
  failed: chalk.red,
  retrying: chalk.yellow,
};

export function colorStatus(status: string): string {
  return (STATUS_COLORS[status] ?? chalk.white)(status);
}

export function printTaskTable(tasks: Task[], states?: Map<string, StateFile>): void {
  const table = new Table({
    head: ["Task ID", "Goal", "Status", "Steps", "Attempts"].map((h) =>
      chalk.bold(h)
    ),
    colWidths: [22, 40, 12, 7, 9],
    wordWrap: true,
  });

  for (const task of tasks) {
    const state = states?.get(task.task_id);
    const attempts = state?.runs.length ?? 0;
    const doneSteps = task.steps.filter((s) => s.status === "done").length;
    table.push([
      task.task_id,
      task.goal.slice(0, 38),
      colorStatus(task.status),
      `${doneSteps}/${task.steps.length}`,
      String(attempts),
    ]);
  }

  console.log(table.toString());
}

export function printHeader(title: string): void {
  console.log(chalk.bold.cyan(`\n⚙  BEE — ${title}\n`));
}
