import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Planner } from "../../tasks/planner.ts";
import { TaskWriter } from "../../tasks/writer.ts";
import { printHeader, printTaskTable } from "../output.ts";
import chalk from "chalk";

export interface PlanOptions {
  provider?: string;
  taskId?: string;
}

export async function runPlan(
  specFile: string,
  tasksDir: string,
  opts: PlanOptions = {}
): Promise<void> {
  printHeader("Plan");

  if (!existsSync(specFile)) {
    console.error(chalk.red(`Spec file not found: ${specFile}`));
    process.exit(1);
  }

  const content = await readFile(specFile, "utf-8");
  console.log(chalk.gray(`Reading spec: ${specFile}`));

  const planner = new Planner();
  const writer = new TaskWriter(tasksDir);

  console.log(chalk.gray("Generating task plan..."));
  const task = await planner.fromSpec(content, {
    provider: opts.provider,
    taskId: opts.taskId,
  });

  const path = await writer.write(task);
  console.log(chalk.green(`✓ Task created: ${path}\n`));

  printTaskTable([task]);
  console.log();
}
