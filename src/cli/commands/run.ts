import { AgentLoop } from "../../agent/loop.ts";
import type { WorkspaceConfig } from "../../types/config.ts";
import { printHeader } from "../output.ts";

export interface RunOptions {
  taskId?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function runRun(
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string },
  opts: RunOptions = {}
): Promise<void> {
  printHeader(opts.dryRun ? "Run (dry-run)" : "Run");

  const loop = new AgentLoop(config, dirs);
  await loop.run(opts);
}
