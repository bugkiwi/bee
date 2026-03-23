import type { AgentTask as Task } from "../types/task.ts";
import { TaskSchema } from "../schema/task.schema.ts";
import { readJsonFile, listFiles } from "../utils/fs.ts";

export class TaskLoader {
  constructor(private readonly tasksDir: string) {}

  async loadAll(): Promise<Task[]> {
    const files = await listFiles(this.tasksDir, ".json");
    const tasks: Task[] = [];

    for (const file of files) {
      const task = await this.loadFile(file);
      if (task) tasks.push(task);
    }

    return tasks.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  async load(taskId: string): Promise<Task | null> {
    const file = `${this.tasksDir}/${taskId}.json`;
    return this.loadFile(file);
  }

  private async loadFile(path: string): Promise<Task | null> {
    try {
      const raw = await readJsonFile(path);
      const parsed = TaskSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`Invalid task file ${path}:`, parsed.error.message);
        return null;
      }
      return parsed.data as Task;
    } catch (err) {
      console.error(`Failed to load task file ${path}:`, err);
      return null;
    }
  }
}
