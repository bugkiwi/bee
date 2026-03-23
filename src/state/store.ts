import { join } from "node:path";
import type { StateFile } from "../types/state.ts";
import type { AgentTaskStatus as TaskStatus } from "../types/task.ts";
import { StateFileSchema } from "../schema/state.schema.ts";
import { readJsonFile, writeJsonFile } from "../utils/fs.ts";

export class StateStore {
  constructor(private readonly stateDir: string) {}

  private stateFilePath(taskId: string): string {
    return join(this.stateDir, `${taskId}.json`);
  }

  async load(taskId: string): Promise<StateFile | null> {
    try {
      const raw = await readJsonFile(this.stateFilePath(taskId));
      const parsed = StateFileSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`State file for ${taskId} is invalid:`, parsed.error.message);
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async save(state: StateFile): Promise<void> {
    await writeJsonFile(this.stateFilePath(state.task_id), state);
  }

  async init(taskId: string, initialStatus: TaskStatus = "pending"): Promise<StateFile> {
    const existing = await this.load(taskId);
    if (existing) return existing;
    const state: StateFile = {
      task_id: taskId,
      current_status: initialStatus,
      runs: [],
    };
    await this.save(state);
    return state;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const state = await this.load(taskId);
    if (!state) throw new Error(`No state found for task: ${taskId}`);
    state.current_status = status;
    await this.save(state);
  }
}
