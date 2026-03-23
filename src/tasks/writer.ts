import { join } from "node:path";
import type { AgentTask as Task } from "../types/task.ts";
import { writeJsonFile } from "../utils/fs.ts";

export class TaskWriter {
  constructor(private readonly tasksDir: string) {}

  async write(task: Task): Promise<string> {
    const path = join(this.tasksDir, `${task.task_id}.json`);
    await writeJsonFile(path, task);
    return path;
  }

  async update(task: Task): Promise<void> {
    task.updated_at = new Date().toISOString();
    await this.write(task);
  }
}
