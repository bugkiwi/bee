import type { Dispatch } from "../state/actions.ts";
import {
	appendLogLine,
	setTaskDone,
	setTaskFailed,
	setTaskStarted,
} from "../state/actions.ts";
import type { Task } from "../types/task.ts";

export type { Dispatch };

/**
 * Launches a sub-chat agent for the given task.
 *
 * Sequence:
 *  1. Dispatch SET_TASK_STARTED  — sets status=running, stamps startedAt
 *  2. Spawn a general-purpose agent subprocess for task.goal
 *  3. Stream stdout chunks through the log-append action
 *  4. On completion dispatch SET_TASK_DONE (exit 0) or SET_TASK_FAILED (non-zero / error)
 *
 * Returns a Promise that resolves once the sub-chat agent has fully completed.
 */
export async function launchTask(
	task: Task,
	dispatch: Dispatch,
): Promise<void> {
	// ── Step 1: stamp startedAt and transition to running BEFORE spawning ──────
	dispatch((state) => setTaskStarted(state, task.id));

	try {
		// ── Step 2: spawn the agent subprocess ────────────────────────────────────
		const proc = Bun.spawn(["sh", "-c", task.goal], {
			stdout: "pipe",
			stderr: "pipe",
		});

		// ── Step 3: stream stdout through log-append ──────────────────────────────
		const decoder = new TextDecoder();
		let buffer = "";

		const reader = proc.stdout.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Flush complete lines from the buffer
			const newlineIdx = buffer.lastIndexOf("\n");
			if (newlineIdx !== -1) {
				const completed = buffer.slice(0, newlineIdx);
				buffer = buffer.slice(newlineIdx + 1);
				for (const line of completed.split("\n")) {
					dispatch((state) => appendLogLine(state, task.id, line));
				}
			}
		}

		// Flush any remaining bytes that had no trailing newline
		const tail = decoder.decode(undefined, { stream: false });
		const remaining = buffer + tail;
		if (remaining) {
			dispatch((state) => appendLogLine(state, task.id, remaining));
		}

		// ── Step 4: dispatch done or failed based on exit code ───────────────────
		const exitCode = await proc.exited;
		if (exitCode === 0) {
			dispatch((state) => setTaskDone(state, task.id));
		} else {
			dispatch((state) =>
				setTaskFailed(state, task.id, `Process exited with code ${exitCode}`),
			);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		dispatch((state) => setTaskFailed(state, task.id, message));
	}
}
