import { AgentLoop, NodeFailedError } from "../../agent/loop.ts";
import { TaskLoader } from "../../tasks/loader.ts";
import { StateStore } from "../../state/store.ts";
import { SkeletonStore } from "../../state/skeleton.ts";
import type { WorkspaceConfig } from "../../types/config.ts";
import { printHeader, colorStatus } from "../output.ts";
import chalk from "chalk";

export async function runResume(
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string },
  taskId?: string
): Promise<void> {
  printHeader("Resume");

  // ── Check for incomplete skeletons first ─────────────────────────────────
  const skeletonStore = new SkeletonStore(dirs.state);
  const incompleteSkeletons = await skeletonStore.listIncomplete();

  if (incompleteSkeletons.length > 0 && !taskId) {
    console.log(chalk.bold(`Found ${incompleteSkeletons.length} incomplete skeleton(s):\n`));
    for (let i = 0; i < incompleteSkeletons.length; i++) {
      const sk = incompleteSkeletons[i]!;
      const done = sk.nodes.filter((n) => n.status === "done").length;
      console.log(
        `  ${i + 1}. ${chalk.cyan(sk.id)} — "${sk.goal}" (${done}/${sk.nodes.length} nodes done)`
      );
    }
    console.log();

    // If exactly one, resume it automatically
    if (incompleteSkeletons.length === 1) {
      const sk = incompleteSkeletons[0]!;
      console.log(chalk.yellow(`Resuming skeleton: ${sk.goal}\n`));
      const loop = new AgentLoop(config, dirs);
      try {
        await loop.runSkeleton(sk.goal, {
          onSkeletonReady: async (_skeleton, _cost) => {
            // On resume, skip confirmation — skeleton already approved
            return true;
          },
        });
      } catch (err) {
        if (err instanceof NodeFailedError) {
          console.error(chalk.red(`\nNode "${err.nodeTitle}" failed again.`));
          process.exit(1);
        }
        throw err;
      }
      return;
    }

    // Multiple skeletons — prompt user to pick
    console.log(chalk.gray("Multiple skeletons found. Run `bee resume --skeleton <id>` to resume a specific one."));
    return;
  }

  // ── Existing task resume logic ────────────────────────────────────────────
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
