import { Command } from "commander";
import { findWorkspaceRoot, getWorkspaceDirs } from "../utils/workspace.ts";
import { readJsonFile } from "../utils/fs.ts";
import {
  DEFAULT_CONFIG,
  normalizeProviderName,
  normalizeWorkspaceConfig,
  type WorkspaceConfig,
} from "../types/config.ts";
import { WorkspaceConfigSchema } from "../schema/config.schema.ts";

import { runInit } from "./commands/init.ts";
import { runPlan } from "./commands/plan.ts";
import { runRun } from "./commands/run.ts";
import { runResume } from "./commands/resume.ts";
import { runVerify } from "./commands/verify.ts";
import { runReplay } from "./commands/replay.ts";
import { runSkeleton } from "./commands/skeleton.ts";
import { runAsk } from "./commands/ask.ts";

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const raw = await readJsonFile(configPath);
    const parsed = WorkspaceConfigSchema.safeParse(raw);
    return parsed.success
      ? normalizeWorkspaceConfig(parsed.data as WorkspaceConfig)
      : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function buildCli(): Command {
  const program = new Command("bee")
    .description("BEE — deterministic coding agent orchestrator")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize BEE workspace")
    .action(async () => {
      const root = findWorkspaceRoot();
      await runInit(root);
    });

  program
    .command("plan <spec-file>")
    .description("Generate a task plan from a spec file")
    .option("--provider <name>", "Provider to use (claude|codex)", "claude")
    .option("--task-id <id>", "Custom task ID")
    .action(async (specFile: string, opts: { provider?: string; taskId?: string }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      await runPlan(specFile, dirs.tasks, opts);
    });

  program
    .command("run [task-id]")
    .description("Run pending tasks")
    .option("--provider <name>", "Override provider")
    .option("--dry-run", "Show what would run without executing")
    .option("-v, --verbose", "Verbose output")
    .action(async (taskId: string | undefined, opts: { provider?: string; dryRun?: boolean; verbose?: boolean }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      const config = await loadConfig(dirs.config);
      if (opts.provider) config.provider = normalizeProviderName(opts.provider);
      await runRun(config, dirs, { taskId, dryRun: opts.dryRun, verbose: opts.verbose });
    });

  program
    .command("resume [task-id]")
    .description("Resume incomplete tasks")
    .action(async (taskId: string | undefined) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      const config = await loadConfig(dirs.config);
      await runResume(config, dirs, taskId);
    });

  program
    .command("verify [task-id]")
    .description("Verify task completion")
    .option("--all", "Verify all tasks")
    .action(async (taskId: string | undefined, opts: { all?: boolean }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      await runVerify(dirs, taskId, opts);
    });

  program
    .command("replay <task-id>")
    .description("Replay execution log for a task")
    .option("--trace-id <id>", "Specific trace ID to replay")
    .option("--from <timestamp>", "Replay from timestamp")
    .option("--to <timestamp>", "Replay to timestamp")
    .action(async (taskId: string, opts: { traceId?: string; from?: string; to?: string }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      await runReplay(dirs.logs, taskId, opts);
    });

  program
    .command("skeleton <goal>")
    .description("Generate and execute a skeleton plan for a high-level goal")
    .option("--provider <name>", "Override provider")
    .option("--pause", "Pause between nodes for confirmation")
    .action(async (goal: string, opts: { provider?: string; pause?: boolean }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      const config = await loadConfig(dirs.config);
      if (opts.provider) config.provider = normalizeProviderName(opts.provider);
      if (opts.pause) config.pause_between_nodes = true;
      await runSkeleton(goal, config, dirs);
    });

  program
    .command("ask <goal>")
    .description("Recursively decompose and execute a goal (writes full plan to .bee/plans/)")
    .option("--provider <name>", "Override provider")
    .action(async (goal: string, opts: { provider?: string }) => {
      const root = findWorkspaceRoot();
      const dirs = getWorkspaceDirs(root);
      const config = await loadConfig(dirs.config);
      if (opts.provider) config.provider = normalizeProviderName(opts.provider);
      await runAsk(goal, config, dirs);
    });

  return program;
}
