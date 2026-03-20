import { AgentLoop, UserAbortError, NodeFailedError } from "../../agent/loop.ts";
import type { WorkspaceConfig } from "../../types/config.ts";
import type { AskPlan, AskPlanNode } from "../../types/ask-plan.ts";
import { printHeader } from "../output.ts";
import chalk from "chalk";
import * as readline from "node:readline";

export interface RunAskOptions {
  /** When true, skip readline confirmation and execute immediately after showing the plan. */
  autoConfirm?: boolean;
}

export async function runAsk(
  goal: string,
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string; plans: string },
  opts: RunAskOptions = {}
): Promise<void> {
  if (!opts.autoConfirm) {
    printHeader("Ask");
  }

  const loop = new AgentLoop(config, dirs);

  try {
    await loop.runAsk(goal, {
      onPlanReady: async (plan) => {
        printAskPlan(plan);
        if (opts.autoConfirm) return true;
        return await confirmProceed();
      },
    });
  } catch (err) {
    if (err instanceof UserAbortError) {
      if (!opts.autoConfirm) process.exit(0);
      return;
    }
    if (err instanceof NodeFailedError) {
      console.error(chalk.red(`\nNode "${err.nodeTitle}" failed.`));
      console.error(chalk.gray("Check .bee/plans/ for plan state."));
      if (!opts.autoConfirm) process.exit(1);
      return;
    }
    throw err;
  }
}

export function printAskPlan(plan: AskPlan): void {
  console.log(chalk.bold(`\nPlan: ${plan.goal}`));
  console.log(chalk.gray(`Saved: .bee/plans/ask-${plan.id}.json\n`));
  printNodes(plan.root_nodes, 0);
  console.log();
}

function printNodes(nodes: AskPlanNode[], indent: number): void {
  const pad = "  ".repeat(indent);
  for (const node of nodes) {
    const prefix = node.sub_nodes ? chalk.yellow("▸") : chalk.cyan("•");
    console.log(`${pad}${prefix} ${chalk.bold(node.title)}`);
    console.log(`${pad}  ${chalk.gray(node.description)}`);
    if (node.acceptance_criteria.length > 0) {
      console.log(`${pad}  ${chalk.gray("✓ " + node.acceptance_criteria[0])}`);
    }
    if (node.sub_nodes && node.sub_nodes.length > 0) {
      printNodes(node.sub_nodes, indent + 1);
    }
  }
}

async function confirmProceed(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.yellow("\nExecute this plan? [Enter=yes / n=no] "), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== "n");
    });
  });
}
