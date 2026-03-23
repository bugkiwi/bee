/**
 * Tests for SubChatPanelList data-derivation logic.
 *
 * We test the pure `derivePanelProps` helper — no Ink rendering required,
 * consistent with the rest of this test suite.
 */

import { describe, expect, it } from "bun:test";
import type { AppState } from "../../types/state.ts";
import { MessageRole } from "../../types/subchat.ts";
import type { ChatMessage, SubChat } from "../../types/subchat.ts";
import { TaskStatus } from "../../types/task.ts";
import type { Task } from "../../types/task.ts";
import { derivePanelProps } from "./SubChatPanelList.tsx";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		planId: "plan-1",
		goal: "Default goal",
		steps: [],
		status: TaskStatus.pending,
		logLines: [],
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeMessage(content: string): ChatMessage {
	return {
		id: `msg-${Math.random()}`,
		role: MessageRole.assistant,
		content,
		timestamp: new Date("2026-01-01T00:00:00Z"),
	};
}

function makeSubChat(overrides: Partial<SubChat> = {}): SubChat {
	return {
		id: "sc-1",
		messages: [],
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function makeAppState(
	tasks: Record<string, Task>,
	subChats: Record<string, SubChat> = {},
): AppState {
	return {
		plans: { plans: {}, selectedPlanId: null, loading: false, error: null },
		tasks: { tasks, activeTaskId: null, loading: false, error: null },
		subChats: { subChats, loading: false, error: null },
	};
}

// ─── Panel count tests ────────────────────────────────────────────────────────

describe("SubChatPanelList — panel count", () => {
	it("produces zero panels when there are no tasks", () => {
		const state = makeAppState({});
		expect(derivePanelProps(state)).toHaveLength(0);
	});

	it("produces exactly 1 panel for 1 task", () => {
		const state = makeAppState({ "task-1": makeTask({ id: "task-1" }) });
		expect(derivePanelProps(state)).toHaveLength(1);
	});

	it("produces exactly 3 panels for 3 tasks", () => {
		const state = makeAppState({
			"task-1": makeTask({ id: "task-1" }),
			"task-2": makeTask({ id: "task-2" }),
			"task-3": makeTask({ id: "task-3" }),
		});
		expect(derivePanelProps(state)).toHaveLength(3);
	});

	it("panel count equals task count for arbitrary N", () => {
		for (const n of [0, 1, 2, 5, 10]) {
			const tasks: Record<string, Task> = {};
			for (let i = 0; i < n; i++) {
				tasks[`task-${i}`] = makeTask({ id: `task-${i}`, goal: `Goal ${i}` });
			}
			expect(derivePanelProps(makeAppState(tasks))).toHaveLength(n);
		}
	});
});

// ─── Per-panel title and taskId ───────────────────────────────────────────────

describe("SubChatPanelList — panel titles", () => {
	it("panel title equals the task goal", () => {
		const state = makeAppState({
			"task-1": makeTask({ id: "task-1", goal: "Write the docs" }),
		});
		const panel = derivePanelProps(state)[0]!;
		expect(panel.title).toBe("Write the docs");
		expect(panel.taskId).toBe("task-1");
	});

	it("each panel title matches its corresponding task — no cross-bleeding", () => {
		const state = makeAppState({
			"task-a": makeTask({ id: "task-a", goal: "Alpha task" }),
			"task-b": makeTask({ id: "task-b", goal: "Beta task" }),
			"task-c": makeTask({ id: "task-c", goal: "Gamma task" }),
		});

		const panels = derivePanelProps(state);
		const byTaskId = Object.fromEntries(panels.map((p) => [p.taskId, p]));

		expect(byTaskId["task-a"]!.title).toBe("Alpha task");
		expect(byTaskId["task-b"]!.title).toBe("Beta task");
		expect(byTaskId["task-c"]!.title).toBe("Gamma task");
	});

	it("taskId on each panel matches the source task id", () => {
		const ids = ["x-1", "x-2", "x-3"];
		const tasks: Record<string, Task> = {};
		ids.forEach((id) => {
			tasks[id] = makeTask({ id, goal: `Goal for ${id}` });
		});

		const panels = derivePanelProps(makeAppState(tasks));
		const panelIds = panels.map((p) => p.taskId).sort();
		expect(panelIds).toEqual([...ids].sort());
	});
});

// ─── Log-line isolation (no data bleeding between tasks) ─────────────────────

describe("SubChatPanelList — log-line isolation", () => {
	it("prefers task.logLines when they are already present", () => {
		const state = makeAppState(
			{
				"task-1": makeTask({
					id: "task-1",
					logLines: ["from task state"],
				}),
			},
			{
				"sc-1": makeSubChat({
					id: "sc-1",
					taskId: "task-1",
					messages: [makeMessage("from subchat")],
				}),
			},
		);

		const panel = derivePanelProps(state)[0]!;
		expect(panel.logLines).toEqual(["from task state"]);
	});

	it("a panel has no log lines when no sub-chats are linked to it", () => {
		const state = makeAppState({
			"task-1": makeTask({ id: "task-1" }),
		});
		const panel = derivePanelProps(state)[0]!;
		expect(panel.logLines).toHaveLength(0);
	});

	it("log lines come only from sub-chats whose taskId matches", () => {
		const state = makeAppState(
			{
				"task-1": makeTask({ id: "task-1", goal: "Task One" }),
				"task-2": makeTask({ id: "task-2", goal: "Task Two" }),
			},
			{
				"sc-a": makeSubChat({
					id: "sc-a",
					taskId: "task-1",
					messages: [makeMessage("line A1"), makeMessage("line A2")],
				}),
				"sc-b": makeSubChat({
					id: "sc-b",
					taskId: "task-2",
					messages: [makeMessage("line B1")],
				}),
			},
		);

		const panels = derivePanelProps(state);
		const byId = Object.fromEntries(panels.map((p) => [p.taskId, p]));

		expect(byId["task-1"]!.logLines).toEqual(["line A1", "line A2"]);
		expect(byId["task-2"]!.logLines).toEqual(["line B1"]);
	});

	it("task-1 panel does not contain log lines from task-2's sub-chats", () => {
		const state = makeAppState(
			{
				"task-1": makeTask({ id: "task-1" }),
				"task-2": makeTask({ id: "task-2" }),
			},
			{
				"sc-only-task2": makeSubChat({
					id: "sc-only-task2",
					taskId: "task-2",
					messages: [makeMessage("secret log from task 2")],
				}),
			},
		);

		const panels = derivePanelProps(state);
		const byId = Object.fromEntries(panels.map((p) => [p.taskId, p]));

		expect(byId["task-1"]!.logLines).toHaveLength(0);
		expect(byId["task-2"]!.logLines).toContain("secret log from task 2");
	});

	it("sub-chats with no taskId are not included in any panel's log lines", () => {
		const state = makeAppState(
			{ "task-1": makeTask({ id: "task-1" }) },
			{
				"sc-orphan": makeSubChat({
					id: "sc-orphan",
					taskId: undefined,
					messages: [makeMessage("orphan line")],
				}),
			},
		);
		const panel = derivePanelProps(state)[0]!;
		expect(panel.logLines).toHaveLength(0);
	});

	it("multiple sub-chats for the same task are concatenated in order", () => {
		const state = makeAppState(
			{ "task-1": makeTask({ id: "task-1" }) },
			{
				"sc-1": makeSubChat({
					id: "sc-1",
					taskId: "task-1",
					messages: [makeMessage("first"), makeMessage("second")],
				}),
				"sc-2": makeSubChat({
					id: "sc-2",
					taskId: "task-1",
					messages: [makeMessage("third")],
				}),
			},
		);
		const panel = derivePanelProps(state)[0]!;
		expect(panel.logLines).toContain("first");
		expect(panel.logLines).toContain("second");
		expect(panel.logLines).toContain("third");
		expect(panel.logLines).toHaveLength(3);
	});
});

// ─── Status forwarding ────────────────────────────────────────────────────────

describe("SubChatPanelList — status forwarding", () => {
	it("panel status matches the task status", () => {
		for (const status of Object.values(TaskStatus)) {
			const state = makeAppState({
				"task-1": makeTask({ id: "task-1", status }),
			});
			const panel = derivePanelProps(state)[0]!;
			expect(panel.status).toBe(status);
		}
	});
});
