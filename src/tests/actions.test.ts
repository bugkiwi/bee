import { describe, expect, it } from "bun:test";
import { appendLogLine, reducer } from "../state/actions.ts";
import type { AppState } from "../types/state.ts";
import { TaskStatus } from "../types/task.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(logLines: string[] = []): AppState {
	return {
		plans: { plans: {}, selectedPlanId: null, loading: false, error: null },
		tasks: {
			tasks: {
				"task-1": {
					id: "task-1",
					planId: "plan-1",
					goal: "Write tests",
					steps: [],
					status: TaskStatus.pending,
					logLines,
					createdAt: "2026-03-23T00:00:00Z",
					updatedAt: "2026-03-23T00:00:00Z",
				},
			},
			activeTaskId: "task-1",
			loading: false,
			error: null,
		},
		subChats: { subChats: {}, loading: false, error: null },
	};
}

// ─── appendLogLine ─────────────────────────────────────────────────────────────

describe("appendLogLine", () => {
	it("appends a line to an empty logLines array", () => {
		const state = makeState([]);
		const next = appendLogLine(state, "task-1", "hello");
		expect(next.tasks.tasks["task-1"]!.logLines).toEqual(["hello"]);
	});

	it("appends to existing lines", () => {
		const state = makeState(["first"]);
		const next = appendLogLine(state, "task-1", "second");
		expect(next.tasks.tasks["task-1"]!.logLines).toEqual(["first", "second"]);
	});

	it("does not mutate the original state", () => {
		const state = makeState(["original"]);
		appendLogLine(state, "task-1", "new");
		expect(state.tasks.tasks["task-1"]!.logLines).toEqual(["original"]);
	});

	it("returns unchanged state for unknown taskId", () => {
		const state = makeState([]);
		const next = appendLogLine(state, "no-such-task", "line");
		expect(next).toBe(state);
	});

	it("only modifies the targeted task", () => {
		const state: AppState = {
			...makeState(["a"]),
			tasks: {
				...makeState(["a"]).tasks,
				tasks: {
					...makeState(["a"]).tasks.tasks,
					"task-2": {
						id: "task-2",
						planId: "plan-1",
						goal: "Other task",
						steps: [],
						status: TaskStatus.pending,
						logLines: ["x"],
						createdAt: "2026-03-23T00:00:00Z",
						updatedAt: "2026-03-23T00:00:00Z",
					},
				},
			},
		};
		const next = appendLogLine(state, "task-1", "appended");
		expect(next.tasks.tasks["task-1"]!.logLines).toEqual(["a", "appended"]);
		expect(next.tasks.tasks["task-2"]!.logLines).toEqual(["x"]);
	});

	it("preserves all other task fields", () => {
		const state = makeState([]);
		const next = appendLogLine(state, "task-1", "log");
		const task = next.tasks.tasks["task-1"]!;
		expect(task.id).toBe("task-1");
		expect(task.goal).toBe("Write tests");
		expect(task.status).toBe(TaskStatus.pending);
	});

	it("preserves other slices of AppState", () => {
		const state = makeState([]);
		const next = appendLogLine(state, "task-1", "log");
		expect(next.plans).toBe(state.plans);
		expect(next.subChats).toBe(state.subChats);
	});
});

// ─── reducer: SET_TASK_STARTED ─────────────────────────────────────────────────

describe("reducer SET_TASK_STARTED", () => {
	it("sets status to running and stamps startedAt", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_STARTED",
			task_id: "task-1",
			startedAt: "2026-03-23T10:00:00Z",
		});
		const task = next.tasks.tasks["task-1"]!;
		expect(task.status).toBe(TaskStatus.running);
		expect(task.startedAt).toBe("2026-03-23T10:00:00Z");
	});

	it("returns state unchanged for unknown task_id", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_STARTED",
			task_id: "no-such-task",
			startedAt: "2026-03-23T10:00:00Z",
		});
		expect(next).toBe(state);
	});

	it("does not mutate the original state", () => {
		const state = makeState([]);
		reducer(state, {
			type: "SET_TASK_STARTED",
			task_id: "task-1",
			startedAt: "2026-03-23T10:00:00Z",
		});
		expect(state.tasks.tasks["task-1"]!.status).toBe(TaskStatus.pending);
		expect(state.tasks.tasks["task-1"]!.startedAt).toBeUndefined();
	});

	it("preserves all other task fields", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_STARTED",
			task_id: "task-1",
			startedAt: "2026-03-23T10:00:00Z",
		});
		const task = next.tasks.tasks["task-1"]!;
		expect(task.id).toBe("task-1");
		expect(task.goal).toBe("Write tests");
		expect(task.logLines).toEqual([]);
	});

	it("preserves other AppState slices", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_STARTED",
			task_id: "task-1",
			startedAt: "2026-03-23T10:00:00Z",
		});
		expect(next.plans).toBe(state.plans);
		expect(next.subChats).toBe(state.subChats);
	});
});

// ─── reducer: SET_TASK_DONE ────────────────────────────────────────────────────

describe("reducer SET_TASK_DONE", () => {
	it("sets status to completed, stamps completedAt", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "task-1",
			completedAt: "2026-03-23T11:00:00Z",
		});
		const task = next.tasks.tasks["task-1"]!;
		expect(task.status).toBe(TaskStatus.completed);
		expect(task.completedAt).toBe("2026-03-23T11:00:00Z");
	});

	it("stores result in metadata when provided", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "task-1",
			completedAt: "2026-03-23T11:00:00Z",
			result: { output: "ok" },
		});
		expect(next.tasks.tasks["task-1"]!.metadata?.result).toEqual({
			output: "ok",
		});
	});

	it("does not add metadata when result is undefined", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "task-1",
			completedAt: "2026-03-23T11:00:00Z",
		});
		expect(next.tasks.tasks["task-1"]!.metadata).toBeUndefined();
	});

	it("returns state unchanged for unknown task_id", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "no-such-task",
			completedAt: "2026-03-23T11:00:00Z",
		});
		expect(next).toBe(state);
	});

	it("does not mutate the original state", () => {
		const state = makeState([]);
		reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "task-1",
			completedAt: "2026-03-23T11:00:00Z",
		});
		expect(state.tasks.tasks["task-1"]!.status).toBe(TaskStatus.pending);
		expect(state.tasks.tasks["task-1"]!.completedAt).toBeUndefined();
	});

	it("preserves other AppState slices", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_DONE",
			task_id: "task-1",
			completedAt: "2026-03-23T11:00:00Z",
		});
		expect(next.plans).toBe(state.plans);
		expect(next.subChats).toBe(state.subChats);
	});
});

// ─── reducer: SET_TASK_FAILED ──────────────────────────────────────────────────

describe("reducer SET_TASK_FAILED", () => {
	it("sets status to failed, stamps completedAt, records error in metadata", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_FAILED",
			task_id: "task-1",
			completedAt: "2026-03-23T12:00:00Z",
			error: "provider timeout",
		});
		const task = next.tasks.tasks["task-1"]!;
		expect(task.status).toBe(TaskStatus.failed);
		expect(task.completedAt).toBe("2026-03-23T12:00:00Z");
		expect(task.metadata?.error).toBe("provider timeout");
	});

	it("returns state unchanged for unknown task_id", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_FAILED",
			task_id: "no-such-task",
			completedAt: "2026-03-23T12:00:00Z",
			error: "oops",
		});
		expect(next).toBe(state);
	});

	it("does not mutate the original state", () => {
		const state = makeState([]);
		reducer(state, {
			type: "SET_TASK_FAILED",
			task_id: "task-1",
			completedAt: "2026-03-23T12:00:00Z",
			error: "boom",
		});
		expect(state.tasks.tasks["task-1"]!.status).toBe(TaskStatus.pending);
		expect(state.tasks.tasks["task-1"]!.completedAt).toBeUndefined();
	});

	it("merges error into existing metadata without clobbering other keys", () => {
		const base = makeState([]);
		const stateWithMeta: AppState = {
			...base,
			tasks: {
				...base.tasks,
				tasks: {
					...base.tasks.tasks,
					"task-1": {
						...base.tasks.tasks["task-1"]!,
						metadata: { foo: "bar" },
					},
				},
			},
		};
		const next = reducer(stateWithMeta, {
			type: "SET_TASK_FAILED",
			task_id: "task-1",
			completedAt: "2026-03-23T12:00:00Z",
			error: "failed",
		});
		expect(next.tasks.tasks["task-1"]!.metadata?.foo).toBe("bar");
		expect(next.tasks.tasks["task-1"]!.metadata?.error).toBe("failed");
	});

	it("preserves other AppState slices", () => {
		const state = makeState([]);
		const next = reducer(state, {
			type: "SET_TASK_FAILED",
			task_id: "task-1",
			completedAt: "2026-03-23T12:00:00Z",
			error: "err",
		});
		expect(next.plans).toBe(state.plans);
		expect(next.subChats).toBe(state.subChats);
	});
});
