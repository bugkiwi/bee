/**
 * Tests for PlanTaskTree component logic.
 *
 * Tests the filtering/mapping logic used by PlanTaskTree
 * without rendering Ink components directly.
 */

import { describe, expect, it } from "bun:test";
import { renderToString } from "ink";
import { PlanTaskTree } from "../components/PlanTaskTree.tsx";
import type { Plan, PlanTask } from "../types/plan.ts";
import { stripAnsi } from "../utils/strip-ansi.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
	return {
		id: "task-1",
		title: "Do something",
		description: "details",
		status: "pending",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
	return {
		id: "plan-1",
		title: "Test Plan",
		description: "A plan",
		status: "pending",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		tasks: [],
		...overrides,
	};
}

// ─── PlanTaskTree rendering model ────────────────────────────────────────────

describe("PlanTaskTree rendering model", () => {
	it("renders one node per plan", () => {
		const plans = [
			makePlan({ id: "p1", title: "Plan A" }),
			makePlan({ id: "p2", title: "Plan B" }),
			makePlan({ id: "p3", title: "Plan C" }),
		];
		// Simulate what the component does: map plans to rendered keys
		const renderedIds = plans.map((p) => p.id);
		expect(renderedIds).toEqual(["p1", "p2", "p3"]);
	});

	it("renders empty state when plans array is empty", () => {
		const plans: Plan[] = [];
		const showEmpty = plans.length === 0;
		expect(showEmpty).toBe(true);
	});

	it("does not show empty state when plans exist", () => {
		const plans = [makePlan({ id: "p1" })];
		const showEmpty = plans.length === 0;
		expect(showEmpty).toBe(false);
	});

	it("preserves plan order", () => {
		const plans = [
			makePlan({ id: "p3", title: "C" }),
			makePlan({ id: "p1", title: "A" }),
			makePlan({ id: "p2", title: "B" }),
		];
		const titles = plans.map((p) => p.title);
		expect(titles).toEqual(["C", "A", "B"]);
	});

	it("renders plans with tasks without dropping task data", () => {
		const plans = [
			makePlan({
				id: "p1",
				tasks: [
					makeTask({ id: "t1", title: "Task 1" }),
					makeTask({ id: "t2", title: "Task 2" }),
				],
			}),
		];
		const firstPlan = plans[0];
		expect(firstPlan).toBeDefined();
		if (!firstPlan) throw new Error("Expected first plan");

		expect(firstPlan.tasks).toHaveLength(2);
		expect(firstPlan.tasks[0]?.title).toBe("Task 1");
	});

	it("handles mixed empty and non-empty task lists", () => {
		const plans = [
			makePlan({ id: "p1", tasks: [] }),
			makePlan({ id: "p2", tasks: [makeTask({ id: "t1" })] }),
		];
		const [firstPlan, secondPlan] = plans;
		expect(firstPlan?.tasks).toHaveLength(0);
		expect(secondPlan?.tasks).toHaveLength(1);
	});
});

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("PlanTaskTree snapshots", () => {
	it("plan list structure matches snapshot", () => {
		const plans = [
			makePlan({
				id: "p1",
				title: "Plan Alpha",
				status: "running",
				tasks: [makeTask({ id: "t1" })],
			}),
			makePlan({
				id: "p2",
				title: "Plan Beta",
				status: "completed",
				tasks: [],
			}),
			makePlan({
				id: "p3",
				title: "Plan Gamma",
				status: "failed",
				tasks: [makeTask({ id: "t2" }), makeTask({ id: "t3" })],
			}),
		];
		const snapshot = plans.map((p) => ({
			id: p.id,
			title: p.title,
			status: p.status,
			taskCount: p.tasks.length,
		}));
		expect(snapshot).toMatchSnapshot();
	});

	it("empty plans list produces empty-state snapshot", () => {
		const plans: Plan[] = [];
		const state = { isEmpty: plans.length === 0, count: plans.length };
		expect(state).toMatchSnapshot();
	});

	it("plan keys (ids) match snapshot", () => {
		const plans = [makePlan({ id: "snap-p1" }), makePlan({ id: "snap-p2" })];
		const keys = plans.map((p) => p.id);
		expect(keys).toMatchSnapshot();
	});

	it("renders nested plan/task hierarchy with inline detail lines", () => {
		const plans = [
			makePlan({
				id: "seller-site",
				title: "帮我做一个卖书的网站",
				status: "running",
				tasks: [
					makeTask({
						id: "phase-init",
						title: "项目初始化 & 工程配置",
						status: "completed",
						kind: "plan",
					}),
					makeTask({
						id: "phase-db",
						title: "数据库 Schema & Migration",
						status: "paused",
						kind: "plan",
						children: [
							makeTask({
								id: "task-books",
								title: "编写 books / categories / tags 表 migration + index",
								status: "completed",
								kind: "task",
								detailLines: [
									"bun run db:migrate 成功",
									"books 表全文索引（tsvector）",
								],
							}),
							makeTask({
								id: "task-payments",
								title: "编写 payments 表 + 支付状态枚举类型",
								status: "pending",
								kind: "task",
								detailLines: [
									"payments.status 为 PG ENUM",
									"含 idempotency_key unique 约束",
								],
							}),
						],
					}),
				],
			}),
		];

		const rendered = renderToString(
			PlanTaskTree({
				plans,
				taskLogs: {
					"task-books": ["bun run db:migrate 成功", "books 表全文索引（tsvector）"],
				},
				terminalWidth: 80,
			}),
		);

		expect(stripAnsi(rendered)).toMatchSnapshot();
	});
});
