import type { IProvider, ProviderResult, StreamCallback } from "../types/provider.ts";
import type { Task } from "../types/task.ts";

export abstract class BaseProvider implements IProvider {
  abstract readonly name: string;

  abstract execute(task: Task, traceId: string, onEvent?: StreamCallback): Promise<ProviderResult>;

  async cancel(_runId: string): Promise<void> {
    // Subclasses override if they support cancellation
  }

  async health(): Promise<boolean> {
    return true;
  }

  protected makeError(message: string, output = ""): ProviderResult {
    return { success: false, output, error: message };
  }
}
