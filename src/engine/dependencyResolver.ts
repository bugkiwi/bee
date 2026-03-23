import type { AgentTask } from "../types/task";

/**
 * An AgentTask extended with an optional dependency list.
 * Each entry in depends_on is a task_id that must reach 'done' before this task is ready.
 */
export interface ResolvableTask extends AgentTask {
  depends_on?: string[];
}

/** Returns true when a task has reached the 'done' terminal state. */
export function isDone(task: ResolvableTask): boolean {
  return task.status === "done";
}

/**
 * Returns true when every dependency declared by `task` is present in `taskMap`
 * and has status 'done'.  Tasks with no depends_on (or an empty array) are
 * always considered satisfied.
 */
export function allDepsSatisfied(
  task: ResolvableTask,
  taskMap: Map<string, ResolvableTask>
): boolean {
  if (!task.depends_on || task.depends_on.length === 0) return true;
  return task.depends_on.every((depId) => {
    const dep = taskMap.get(depId);
    return dep !== undefined && isDone(dep);
  });
}

export interface ResolveResult {
  ready: ResolvableTask[];
  blocked: ResolvableTask[];
}

/**
 * Pure dependency resolver.
 *
 * Given a flat list of tasks, partitions all 'pending' tasks into:
 *   - ready   — no outstanding deps (all deps done or none declared)
 *   - blocked — at least one dep is not yet done
 *
 * Non-pending tasks (running, done, failed, …) are excluded from both sets.
 * The function is pure: it never mutates its inputs.
 */
export function resolvePendingTasks(tasks: ResolvableTask[]): ResolveResult {
  const taskMap = new Map<string, ResolvableTask>(
    tasks.map((t) => [t.task_id, t])
  );

  const ready: ResolvableTask[] = [];
  const blocked: ResolvableTask[] = [];

  for (const task of tasks) {
    if (task.status !== "pending") continue;

    if (allDepsSatisfied(task, taskMap)) {
      ready.push(task);
    } else {
      blocked.push(task);
    }
  }

  return { ready, blocked };
}
