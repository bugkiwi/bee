import { AgentLoop } from "../../agent/loop.ts";
import { TaskLoader } from "../../tasks/loader.ts";
import { StateStore } from "../../state/store.ts";
import type { WorkspaceConfig } from "../../types/config.ts";
import { printHeader, colorStatus } from "../output.ts";
import chalk from "chalk";

export async function runResume(
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string },
  taskId?: string
): Promise<void> {
  printHeader("Resume");

  const loader = new TaskLoader(dirs.tasks);
  const store = new StateStore(dirs.state);
  const allTasks = await loader.loadAll();

  const resumable = taskId
    ? allTasks.filter((t) => t.task_id === taskId)
    : allTasks.filter((t) => !["done", "failed"].includes(t.status));

  if (resumable.length === 0) {
    console.log(chalk.yellow("No resumable tasks found."));
    return;
  }

  console.log(`Found ${resumable.length} resumable task(s):\n`);
  for (const task of resumable) {
    const state = await store.load(task.task_id);
    const attempts = state?.runs.length ?? 0;
    console.log(
      `  ${task.task_id} [${colorStatus(task.status)}] — attempt ${attempts}`
    );
  }
  console.log();

  const loop = new AgentLoop(config, dirs);
  for (const task of resumable) {
    await loop.run({ taskId: task.task_id });
  }
}
