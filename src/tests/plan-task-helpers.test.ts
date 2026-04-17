import { describe, expect, it } from "bun:test";
import type { Plan, PlanTask } from "../types/plan.ts";
import {
	buildPlanPresentationModel,
	buildTopLevelRenderEntries,
	derivePlanTimelineEvents,
	resolveTaskExpandedState,
} from "../components/plan-task-helpers.ts";

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
	return {
		id: "task-1",
		title: "Task",
		description: "Task",
		status: "pending",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makePlan(tasks: PlanTask[]): Plan {
	return {
		id: "plan-1",
		title: "Plan",
		description: "Plan",
		status: "running",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		tasks,
	};
}

describe("plan task helpers", () => {
	it("marks pending tasks as blocked when dependencies are incomplete", () => {
		const plan = makePlan([
			makeTask({ id: "a", title: "A", status: "completed", order: 1 }),
			makeTask({
				id: "b",
				title: "B",
				status: "pending",
				order: 2,
				metadata: { dependsOnTitles: ["C"] },
			}),
			makeTask({ id: "c", title: "C", status: "running", order: 3 }),
		]);

		const presentation = buildPlanPresentationModel(plan);
		expect(presentation.taskStateById.b?.blocked).toBe(true);
		expect(presentation.taskStateById.b?.blockedByOrders).toEqual([3]);
	});

	it("groups consecutive unblocked siblings with the same dependency signature", () => {
		const tasks = [
			makeTask({ id: "a", title: "A", order: 1, status: "completed" }),
			makeTask({
				id: "b",
				title: "B",
				order: 2,
				metadata: { dependsOnTitles: ["A"] },
			}),
			makeTask({
				id: "c",
				title: "C",
				order: 3,
				status: "running",
				metadata: { dependsOnTitles: ["A"] },
			}),
		];
		const presentation = buildPlanPresentationModel(makePlan(tasks));
		const entries = buildTopLevelRenderEntries(tasks, presentation.taskStateById);

		expect(entries[1]).toMatchObject({
			type: "parallel-group",
			taskOrders: [2, 3],
		});
	});

	it("lets manual overrides win over auto expansion", () => {
		const task = makeTask({ id: "leaf", status: "running" });
		const presentation = buildPlanPresentationModel(makePlan([task]));
		expect(
			resolveTaskExpandedState(
				task,
				0,
				presentation.taskStateById.leaf,
				["streaming log"],
				true,
				"auto",
			),
		).toBe(true);
		expect(
			resolveTaskExpandedState(
				task,
				0,
				presentation.taskStateById.leaf,
				["streaming log"],
				true,
				"auto",
				false,
			),
		).toBe(false);
	});

	it("derives completion and parallel dispatch events from successive plans", () => {
		const previous = makePlan([
			makeTask({ id: "a", title: "A", order: 1, status: "running" }),
			makeTask({
				id: "b",
				title: "B",
				order: 2,
				status: "pending",
				metadata: { dependsOnTitles: ["A"] },
			}),
			makeTask({
				id: "c",
				title: "C",
				order: 3,
				status: "pending",
				metadata: { dependsOnTitles: ["A"] },
			}),
		]);
		const current = makePlan([
			makeTask({ id: "a", title: "A", order: 1, status: "completed" }),
			makeTask({
				id: "b",
				title: "B",
				order: 2,
				status: "pending",
				metadata: { dependsOnTitles: ["A"] },
			}),
			makeTask({
				id: "c",
				title: "C",
				order: 3,
				status: "pending",
				metadata: { dependsOnTitles: ["A"] },
			}),
		]);

		expect(derivePlanTimelineEvents(previous, current)).toEqual([
			{ tone: "success", text: "#1 complete" },
			{ tone: "info", text: "Dispatching #2 and #3 in parallel" },
		]);
	});
});
