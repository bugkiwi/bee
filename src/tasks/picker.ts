import type { Task } from "../types/task.ts";

export class TaskPicker {
  pickNext(tasks: Task[]): Task | null {
    const eligible = tasks.filter(
      (t) => t.status === "pending" || t.status === "retrying"
    );
    if (eligible.length === 0) return null;
    return eligible.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0] ?? null;
  }

  pickAll(tasks: Task[]): Task[] {
    return tasks
      .filter((t) => !["done", "failed"].includes(t.status))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }
}
