import { TaskLoader } from "../../tasks/loader.ts";
import { StateStore } from "../../state/store.ts";
import { Verifier } from "../../verifier/index.ts";
import { VerificationReporter } from "../../verifier/reporter.ts";
import { printHeader } from "../output.ts";
import chalk from "chalk";

export interface VerifyOptions {
  all?: boolean;
}

export async function runVerify(
  dirs: { tasks: string; state: string },
  taskId?: string,
  opts: VerifyOptions = {}
): Promise<void> {
  printHeader("Verify");

  const loader = new TaskLoader(dirs.tasks);
  const store = new StateStore(dirs.state);
  const verifier = new Verifier();
  const reporter = new VerificationReporter();

  const allTasks = await loader.loadAll();

  let tasks = allTasks;
  if (taskId && !opts.all) {
    tasks = allTasks.filter((t) => t.task_id === taskId);
    if (tasks.length === 0) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
  }

  const summaries = [];
  for (const task of tasks) {
    console.log(chalk.bold(`Verifying: ${task.task_id}`));
    const summary = await verifier.runAll(task);
    reporter.print(summary);
    summaries.push(summary);

    // Update state with verification result
    const state = await store.load(task.task_id);
    if (state) {
      state.last_verified_at = new Date().toISOString();
      if (!summary.passed) {
        state.verification_errors = summary.checks
          .filter((c) => !c.passed)
          .map((c) => c.error ?? `${c.check} failed`);
      } else {
        state.verification_errors = [];
      }
      await store.save(state);
    }
  }

  reporter.printSummaryLine(summaries);
  const allPassed = summaries.every((s) => s.passed);
  if (!allPassed) process.exit(1);
}
