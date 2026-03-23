import type { AgentTask as Task } from "../types/task.ts";
import type { WorkspaceConfig } from "../types/config.ts";

export interface PluginContext {
  task: Task;
  workDir: string;
  config: WorkspaceConfig;
}

export interface BeePlugin<I = unknown, O = unknown> {
  name: string;
  init(ctx: PluginContext): Promise<void>;
  execute(input: I, ctx: PluginContext): Promise<O>;
  verify?(output: O): Promise<boolean>;
}
