import { describe, expect, it } from "bun:test";
import { launchTask } from "../engine/subChatLauncher.ts";
import {
	setTaskDone,
	setTaskFailed,
	setTaskStarted,
} from "../state/actions.ts";
import type { AppState } from "../types/state.ts";
import type { Task } from "../types/task.ts";
import { TaskStatus } from "../types/task.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		planId: "plan-1",
		goal: 'echo "hello"',
		steps: [],
		status: TaskStatus.pending,
		logLines: [],
		createdAt: "2026-03-23T00:00:00Z",
		updatedAt: "2026-03-23T00:00:00Z",
		...overrides,
	};
}

function makeState(task: Task): AppState {
	return {
		plans: { plans: {}, selectedPlanId: null, loading: false, error: null },
		tasks: {
			tasks: { [task.id]: task },
			activeTaskId: task.id,
			loading: false,
			error: null,
		},
		subChats: { subChats: {}, loading: false, error: null },
	};
}

// ─── setTaskStarted ────────────────────────────────────────────────────────────

describe("setTaskStarted", () => {
	it("transitions status to running", () => {
		const task = makeTask();
		const state = makeState(task);
		const next = setTaskStarted(state, task.id);
		expect(next.tasks.tasks[task.id]!.status).toBe(TaskStatus.running);
	});

	it("stamps startedAt with an ISO timestamp", () => {
		const before = Date.now();
		const task = makeTask();
		const state = makeState(task);
		const next = setTaskStarted(state, task.id);
		const startedAt = next.tasks.tasks[task.id]!.startedAt;
		expect(startedAt).toBeDefined();
		expect(new Date(startedAt!).getTime()).toBeGreaterThanOrEqual(before);
	});

	it("returns state unchanged for unknown task", () => {
		const state = makeState(makeTask());
		const next = setTaskStarted(state, "no-such-task");
		expect(next).toBe(state);
	});

	it("does not mutate the original state", () => {
		const task = makeTask();
		const state = makeState(task);
		setTaskStarted(state, task.id);
		expect(state.tasks.tasks[task.id]!.status).toBe(TaskStatus.pending);
	});
});

// ─── setTaskDone ──────────────────────────────────────────────────────────────

describe("setTaskDone", () => {
	it("transitions status to completed", () => {
		const task = makeTask({ status: TaskStatus.running });
		const state = makeState(task);
		const next = setTaskDone(state, task.id);
		expect(next.tasks.tasks[task.id]!.status).toBe(TaskStatus.completed);
	});

	it("returns state unchanged for unknown task", () => {
		const state = makeState(makeTask());
		const next = setTaskDone(state, "no-such-task");
		expect(next).toBe(state);
	});
});

// ─── setTaskFailed ────────────────────────────────────────────────────────────

describe("setTaskFailed", () => {
	it("transitions status to failed", () => {
		const task = makeTask({ status: TaskStatus.running });
		const state = makeState(task);
		const next = setTaskFailed(state, task.id);
		expect(next.tasks.tasks[task.id]!.status).toBe(TaskStatus.failed);
	});

	it("stores the error message in metadata", () => {
		const task = makeTask({ status: TaskStatus.running });
		const state = makeState(task);
		const next = setTaskFailed(state, task.id, "boom");
		expect(next.tasks.tasks[task.id]!.metadata?.error).toBe("boom");
	});

	it("returns state unchanged for unknown task", () => {
		const state = makeState(makeTask());
		const next = setTaskFailed(state, "no-such-task");
		expect(next).toBe(state);
	});
});

// ─── launchTask (integration) ─────────────────────────────────────────────────

describe("launchTask", () => {
	it("sets startedAt before agent begins executing", async () => {
		const task = makeTask({ goal: 'echo "start"' });
		let currentState = makeState(task);
		const dispatchCalls: AppState[] = [];

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
			dispatchCalls.push(currentState);
		};

		await launchTask(task, dispatch);

		// First dispatch must be SET_TASK_STARTED
		expect(dispatchCalls[0]!.tasks.tasks[task.id]!.status).toBe(
			TaskStatus.running,
		);
		expect(dispatchCalls[0]!.tasks.tasks[task.id]!.startedAt).toBeDefined();
	});

	it("transitions: pending → running → completed on success", async () => {
		const task = makeTask({ goal: 'echo "ok"' });
		let currentState = makeState(task);
		const statusLog: TaskStatus[] = [];

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
			statusLog.push(currentState.tasks.tasks[task.id]!.status);
		};

		await launchTask(task, dispatch);

		expect(statusLog[0]).toBe(TaskStatus.running);
		expect(statusLog.at(-1)).toBe(TaskStatus.completed);
	});

	it("transitions: pending → running → failed on non-zero exit", async () => {
		const task = makeTask({ goal: "exit 1" });
		let currentState = makeState(task);
		const statusLog: TaskStatus[] = [];

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
			statusLog.push(currentState.tasks.tasks[task.id]!.status);
		};

		await launchTask(task, dispatch);

		expect(statusLog[0]).toBe(TaskStatus.running);
		expect(statusLog.at(-1)).toBe(TaskStatus.failed);
	});

	it("appends stdout chunks to the task's logLines", async () => {
		const task = makeTask({ goal: 'printf "line1\\nline2\\n"' });
		let currentState = makeState(task);

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
		};

		await launchTask(task, dispatch);

		const logLines = currentState.tasks.tasks[task.id]!.logLines;
		expect(logLines).toContain("line1");
		expect(logLines).toContain("line2");
	});

	it("appends log to the correct task when multiple tasks exist", async () => {
		const task1 = makeTask({ id: "task-1", goal: 'echo "from-1"' });
		const task2: Task = {
			id: "task-2",
			planId: "plan-1",
			goal: "other",
			steps: [],
			status: TaskStatus.pending,
			logLines: ["pre-existing"],
			createdAt: "2026-03-23T00:00:00Z",
			updatedAt: "2026-03-23T00:00:00Z",
		};

		let currentState: AppState = {
			plans: { plans: {}, selectedPlanId: null, loading: false, error: null },
			tasks: {
				tasks: { "task-1": task1, "task-2": task2 },
				activeTaskId: "task-1",
				loading: false,
				error: null,
			},
			subChats: { subChats: {}, loading: false, error: null },
		};

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
		};

		await launchTask(task1, dispatch);

		// task-2 logLines must be untouched
		expect(currentState.tasks.tasks["task-2"]!.logLines).toEqual([
			"pre-existing",
		]);
		// task-1 got output
		expect(
			currentState.tasks.tasks["task-1"]!.logLines.some((l) =>
				l.includes("from-1"),
			),
		).toBe(true);
	});

	it("returns a Promise that resolves only when the sub-chat completes", async () => {
		const task = makeTask({ goal: 'sleep 0.05 && echo "done"' });
		let currentState = makeState(task);
		let resolved = false;

		const dispatch = (updater: (s: AppState) => AppState) => {
			currentState = updater(currentState);
		};

		const p = launchTask(task, dispatch).then(() => {
			resolved = true;
		});

		// Not resolved yet (process is sleeping)
		expect(resolved).toBe(false);

		await p;
		expect(resolved).toBe(true);
		expect(currentState.tasks.tasks[task.id]!.status).toBe(
			TaskStatus.completed,
		);
	});
});
