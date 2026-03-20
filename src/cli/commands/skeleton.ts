import { AgentLoop, UserAbortError, NodeFailedError } from "../../agent/loop.ts";
import type { WorkspaceConfig } from "../../types/config.ts";
import type { PlanSkeleton } from "../../types/skeleton.ts";
import { printHeader } from "../output.ts";
import chalk from "chalk";
import * as readline from "node:readline";

export async function runSkeleton(
  goal: string,
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string }
): Promise<void> {
  printHeader("Skeleton");

  const loop = new AgentLoop(config, dirs);

  try {
    await loop.runSkeleton(goal, {
      onSkeletonReady: async (skeleton, costEstimate) => {
        printSkeletonPreview(skeleton, costEstimate);
        return await confirmProceed();
      },
      onProgress: (event) => {
        // Progress is already printed by AgentLoop console.log calls.
        // This hook is available for TUI integration.
        void event;
      },
    });
  } catch (err) {
    if (err instanceof UserAbortError) {
      // Message already printed by AgentLoop
      process.exit(0);
    }
    if (err instanceof NodeFailedError) {
      console.error(chalk.red(`\nNode "${err.nodeTitle}" failed.`));
      console.error(chalk.gray("Run `bee resume` to retry from this node."));
      process.exit(1);
    }
    throw err;
  }
}

function printSkeletonPreview(skeleton: PlanSkeleton, costEstimate: string): void {
  console.log(chalk.bold(`\nPlan for: ${skeleton.goal}`));
  console.log(chalk.gray(`Estimated cost: ${costEstimate}\n`));

  for (let i = 0; i < skeleton.nodes.length; i++) {
    const node = skeleton.nodes[i]!;
    console.log(chalk.cyan(`  ${i + 1}. ${node.title}`));
    console.log(chalk.gray(`     ${node.description}`));
    if (node.acceptance_criteria.length > 0) {
      console.log(chalk.gray(`     ✓ ${node.acceptance_criteria[0]}`));
    }
  }
  console.log();
}

async function confirmProceed(): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(chalk.yellow("Proceed with this plan? [Enter=yes / n=no] "), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== "n");
    });
  });
}
