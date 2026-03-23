import { describe, expect, it } from "bun:test";
import { renderToString } from "ink";
import { getCollapsibleMetaGroupType } from "../cli/ui/content.ts";
import { PlanTaskTree } from "../components/PlanTaskTree.tsx";
import type { AskPlan } from "../types/ask-plan.ts";
import { PlanStatus, type PlanTask } from "../types/plan.ts";
import { stripAnsi } from "../utils/strip-ansi.ts";
import {
	askPlanToDisplayPlan,
	createAskPlanPreviewMeta,
} from "../utils/ask-plan-preview.ts";

function makeAskPlan(): AskPlan {
	return {
		id: "skeleton_e7da8a734f954da8943410c9a312037b",
		goal: "Fix bee TUI: scrolling conversation history causes process to exit",
		created_at: "2026-03-23T05:18:53.409Z",
		updated_at: "2026-03-23T05:23:03.886Z",
		status: "failed",
		root_nodes: [
			{
				id: "node-1",
				title: "Reproduce & diagnose",
				description:
					"Set up a reliable reproduction case for the scroll-triggered exit bug.",
				acceptance_criteria: [
					"A written repro script exists",
					"The root cause is identified",
				],
				depth: 0,
				status: "failed",
			},
			{
				id: "node-2",
				title: "Implement scroll fix",
				description: "Patch the scroll handler and clamp viewport offsets.",
				acceptance_criteria: [
					"Scrolling no longer exits the process",
				],
				depth: 0,
				status: "pending",
				sub_nodes: [
					{
						id: "node-2-1",
						title: "Clamp offsets",
						description: "Keep scrollbackOffset within legal bounds.",
						acceptance_criteria: ["Offsets stay within 0..max"],
						depth: 1,
						status: "done",
					},
				],
			},
		],
	};
}

function makeLinkedTask(overrides: Partial<PlanTask> = {}): PlanTask {
	return {
		id: "task_scroll_bounds",
		title: "Clamp scrollback offset",
		description: "Clamp scrollback offset",
		status: PlanStatus.running,
		kind: "task",
		detailLines: ["Task task_scroll_bounds", "Next: add bounds check"],
		createdAt: "2026-03-23T05:18:53.409Z",
		updatedAt: "2026-03-23T05:23:03.886Z",
		metadata: { expanded: true },
		...overrides,
	};
}

describe("ask plan preview", () => {
	it("maps ask-plan nodes onto the existing display plan model", () => {
		const plan = askPlanToDisplayPlan(makeAskPlan(), {
			"node-2": [makeLinkedTask()],
		});

		expect(plan.title).toBe(
			"Fix bee TUI: scrolling conversation history causes process to exit",
		);
		expect(plan.status).toBe("failed");
		expect(plan.tasks).toHaveLength(2);
		expect(plan.tasks[0]?.status).toBe("failed");
		expect(plan.tasks[1]?.kind).toBe("plan");
		expect(plan.tasks[1]?.children?.[0]?.status).toBe("completed");
		expect(plan.tasks[1]?.children?.[1]?.title).toBe("Clamp scrollback offset");
		expect(plan.tasks[1]?.metadata?.expanded).toBe(true);
	});

	it("creates plan preview meta that stays out of collapsible tool groups", () => {
		const previewMeta = createAskPlanPreviewMeta(
			makeAskPlan(),
			".bee/plans/ask-skeleton_e7da8a734f954da8943410c9a312037b.json",
		);

		expect(previewMeta.kind).toBe("plan-preview");
		expect(
			getCollapsibleMetaGroupType({
				type: "tool",
				text: "  📖 Ask plan preview",
				meta: previewMeta,
			}),
		).toBeNull();
	});

	it("renders the converted ask plan through PlanTaskTree", () => {
		const rendered = renderToString(
			PlanTaskTree({
				plans: [
					askPlanToDisplayPlan(makeAskPlan(), {
						"node-2": [makeLinkedTask()],
					}),
				],
				terminalWidth: 80,
			}),
		);
		const text = stripAnsi(rendered);

		expect(text).toContain(
			"Fix bee TUI: scrolling conversation history causes process to exit",
		);
		expect(text).toContain("Reproduce & diagnose");
		expect(text).toContain("Set up a reliable reproduction case");
		expect(text).toContain("Clamp offsets");
		expect(text).toContain("Clamp scrollback offset");
		expect(text).toContain("Task task_scroll_bounds");
	});
});
