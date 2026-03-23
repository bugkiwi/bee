import { describe, expect, it, mock } from "bun:test";
import { runOrchestrator } from "../engine/orchestrator.ts";
import type { OrchestrableTask } from "../engine/orchestrator.ts";
import type { Dispatch } from "../state/actions.ts";
import type { AppState } from "../types/state.ts";
import { TaskStatus } from "../types/task.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(
	id: string,
	overrides: Partial<OrchestrableTask> = {},
): OrchestrableTask {
	return {
		id,
		planId: "plan-1",
		goal: `echo "${id}"`,
		steps: [],
		status: TaskStatus.pending,
		logLines: [],
		createdAt: "2026-03-23T00:00:00Z",
		updatedAt: "2026-03-23T00:00:00Z",
		...overrides,
	};
}

function makeState(tasks: OrchestrableTask[]): AppState {
	const taskMap: Record<string, OrchestrableTask> = {};
	for (const t of tasks) taskMap[t.id] = t;
	return {
		plans: { plans: {}, selectedPlanId: null, loading: false, error: null },
		tasks: {
			tasks: taskMap,
			activeTaskId: null,
			loading: false,
			error: null,
		},
		subChats: { subChats: {}, loading: false, error: null },
	};
}

/**
 * Creates a dispatch that applies state updates sequentially and records
 * every (taskId, status) transition for assertions.
 */
function makeDispatch(initialState: AppState): {
	dispatch: Dispatch;
	getState: () => AppState;
	transitions: Array<{ id: string; status: TaskStatus }>;
} {
	let state = initialState;
	const transitions: Array<{ id: string; status: TaskStatus }> = [];

	const dispatch: Dispatch = (updater) => {
		const prev = state;
		state = updater(state);
		// Record status transitions
		for (const [id, task] of Object.entries(state.tasks.tasks)) {
			const prevTask = prev.tasks.tasks[id];
			if (prevTask && task.status !== prevTask.status) {
				transitions.push({ id, status: task.status });
			}
		}
	};

	return { dispatch, getState: () => state, transitions };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runOrchestrator", () => {
	it("resolves immediately when given an empty task list", async () => {
		const { dispatch } = makeDispatch(makeState([]));
		await expect(runOrchestrator([], dispatch)).resolves.toBeUndefined();
	});

	it("resolves a single task with no dependencies", async () => {
		const task = makeTask("t1");
		const { dispatch, getState } = makeDispatch(makeState([task]));

		await runOrchestrator([task], dispatch);

		expect(getState().tasks.tasks["t1"]!.status).toBe(TaskStatus.completed);
	});

	it("launches independent tasks in the same Promise.allSettled batch", async () => {
		const t1 = makeTask("t1");
		const t2 = makeTask("t2");
		const startOrder: string[] = [];

		// Intercept dispatch to record first running transitions
		const baseState = makeState([t1, t2]);
		let state = baseState;

		const dispatch: Dispatch = (updater) => {
			const prev = state;
			state = updater(state);
			for (const [id, task] of Object.entries(state.tasks.tasks)) {
				if (
					task.status === TaskStatus.running &&
					prev.tasks.tasks[id]?.status !== TaskStatus.running
				) {
					startOrder.push(id);
				}
			}
		};

		await runOrchestrator([t1, t2], dispatch);

		// Both must have started (order may vary, but both launched)
		expect(startOrder).toContain("t1");
		expect(startOrder).toContain("t2");
		expect(state.tasks.tasks["t1"]!.status).toBe(TaskStatus.completed);
		expect(state.tasks.tasks["t2"]!.status).toBe(TaskStatus.completed);
	});

	it("does not launch a dependent task until its dependency completes", async () => {
		const t1 = makeTask("t1", { goal: "echo t1" });
		const t2 = makeTask("t2", { goal: "echo t2", depends_on: ["t1"] });
		const tasks = [t1, t2];
		const startedWhileT1Pending: string[] = [];

		let state = makeState(tasks);

		const dispatch: Dispatch = (updater) => {
			const prev = state;
			state = updater(state);
			// Check: if t1 is still pending/running when t2 starts, that's a violation
			for (const [id, task] of Object.entries(state.tasks.tasks)) {
				if (
					id === "t2" &&
					task.status === TaskStatus.running &&
					prev.tasks.tasks["t2"]?.status !== TaskStatus.running
				) {
					const t1Status = state.tasks.tasks["t1"]?.status;
					if (t1Status !== TaskStatus.completed) {
						startedWhileT1Pending.push(`t1 was ${t1Status} when t2 started`);
					}
				}
			}
		};

		await runOrchestrator(tasks, dispatch);

		expect(startedWhileT1Pending).toHaveLength(0);
		expect(state.tasks.tasks["t1"]!.status).toBe(TaskStatus.completed);
		expect(state.tasks.tasks["t2"]!.status).toBe(TaskStatus.completed);
	});

	it("runs a linear chain A → B → C in order", async () => {
		const tA = makeTask("A");
		const tB = makeTask("B", { depends_on: ["A"] });
		const tC = makeTask("C", { depends_on: ["B"] });
		const tasks = [tA, tB, tC];
		const completionOrder: string[] = [];

		let state = makeState(tasks);
		const dispatch: Dispatch = (updater) => {
			const prev = state;
			state = updater(state);
			for (const [id, task] of Object.entries(state.tasks.tasks)) {
				if (
					task.status === TaskStatus.completed &&
					prev.tasks.tasks[id]?.status !== TaskStatus.completed
				) {
					completionOrder.push(id);
				}
			}
		};

		await runOrchestrator(tasks, dispatch);

		expect(completionOrder).toEqual(["A", "B", "C"]);
	});

	it("resolves cleanly when all tasks are done", async () => {
		const tasks = [makeTask("x"), makeTask("y"), makeTask("z")];
		const { dispatch, getState } = makeDispatch(makeState(tasks));

		await runOrchestrator(tasks, dispatch);

		for (const id of ["x", "y", "z"]) {
			expect(getState().tasks.tasks[id]!.status).toBe(TaskStatus.completed);
		}
	});

	it("throws a descriptive error on circular dependency", async () => {
		// A depends on B, B depends on A — unresolvable
		const tA = makeTask("A", { depends_on: ["B"] });
		const tB = makeTask("B", { depends_on: ["A"] });
		const tasks = [tA, tB];
		const { dispatch } = makeDispatch(makeState(tasks));

		await expect(runOrchestrator(tasks, dispatch)).rejects.toThrow(
			/circular dependency/i,
		);
	});

	it("circular error message includes the stuck task IDs", async () => {
		const tA = makeTask("stuck-1", { depends_on: ["stuck-2"] });
		const tB = makeTask("stuck-2", { depends_on: ["stuck-1"] });
		const tasks = [tA, tB];
		const { dispatch } = makeDispatch(makeState(tasks));

		let errorMsg = "";
		try {
			await runOrchestrator(tasks, dispatch);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
		}

		expect(errorMsg).toContain("stuck-1");
		expect(errorMsg).toContain("stuck-2");
	});

	it("handles a diamond dependency: A → B, A → C, B+C → D", async () => {
		const tA = makeTask("A");
		const tB = makeTask("B", { depends_on: ["A"] });
		const tC = makeTask("C", { depends_on: ["A"] });
		const tD = makeTask("D", { depends_on: ["B", "C"] });
		const tasks = [tA, tB, tC, tD];
		const completionOrder: string[] = [];

		let state = makeState(tasks);
		const dispatch: Dispatch = (updater) => {
			const prev = state;
			state = updater(state);
			for (const [id, task] of Object.entries(state.tasks.tasks)) {
				if (
					task.status === TaskStatus.completed &&
					prev.tasks.tasks[id]?.status !== TaskStatus.completed
				) {
					completionOrder.push(id);
				}
			}
		};

		await runOrchestrator(tasks, dispatch);

		// A must be first, D must be last
		expect(completionOrder[0]).toBe("A");
		expect(completionOrder[completionOrder.length - 1]).toBe("D");
		// B and C must come after A and before D
		const bIdx = completionOrder.indexOf("B");
		const cIdx = completionOrder.indexOf("C");
		const aIdx = completionOrder.indexOf("A");
		const dIdx = completionOrder.indexOf("D");
		expect(bIdx).toBeGreaterThan(aIdx);
		expect(cIdx).toBeGreaterThan(aIdx);
		expect(dIdx).toBeGreaterThan(bIdx);
		expect(dIdx).toBeGreaterThan(cIdx);
	});
});
