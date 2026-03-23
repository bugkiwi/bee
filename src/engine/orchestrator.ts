import type { Dispatch } from "../state/actions.ts";
import { TaskStatus } from "../types/task.ts";
import type { Task } from "../types/task.ts";
import { launchTask } from "./subChatLauncher.ts";

/**
 * A Task extended with an optional dependency list.
 * Each entry in depends_on is a task id that must reach 'completed'
 * before this task becomes ready.
 */
export interface OrchestrableTask extends Task {
	depends_on?: string[];
}

/** Returns true when every declared dependency has status TaskStatus.completed. */
function allDepsDone(
	task: OrchestrableTask,
	statusMap: Map<string, TaskStatus>,
): boolean {
	if (!task.depends_on?.length) return true;
	return task.depends_on.every(
		(depId) => statusMap.get(depId) === TaskStatus.completed,
	);
}

/**
 * Drives the full execution cycle for a set of tasks:
 *
 *  1. Resolve which pending tasks are ready (all deps completed).
 *  2. Launch all ready tasks in parallel via Promise.allSettled.
 *  3. After the batch settles, loop and re-resolve.
 *  4. Stop when no tasks remain with 'pending' status.
 *  5. Throw a descriptive error when pending tasks exist but none are ready
 *     (circular dependency).
 */
export async function runOrchestrator(
	initialTasks: OrchestrableTask[],
	dispatch: Dispatch,
): Promise<void> {
	// Local status map — source of truth for dependency resolution.
	const statusMap = new Map<string, TaskStatus>(
		initialTasks.map((t) => [t.id, t.status]),
	);

	while (true) {
		const pending = initialTasks.filter(
			(t) => statusMap.get(t.id) === TaskStatus.pending,
		);

		// Exit condition: no pending tasks remain.
		if (pending.length === 0) break;

		const ready = pending.filter((t) => allDepsDone(t, statusMap));

		// Circular dependency: pending tasks exist but none can proceed.
		if (ready.length === 0) {
			const blockedIds = pending.map((t) => t.id).join(", ");
			throw new Error(
				`Circular dependency detected — tasks are stuck: ${blockedIds}`,
			);
		}

		// Mark as running before awaiting so re-entrant cycles see correct status.
		for (const t of ready) {
			statusMap.set(t.id, TaskStatus.running);
		}

		// Launch the ready batch in parallel and wait for all to settle.
		await Promise.allSettled(
			ready.map(async (t) => {
				try {
					await launchTask(t, dispatch);
					statusMap.set(t.id, TaskStatus.completed);
				} catch {
					statusMap.set(t.id, TaskStatus.failed);
				}
			}),
		);
		// Loop: re-resolve newly unblocked tasks after the batch.
	}
}
