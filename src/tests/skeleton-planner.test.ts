import { describe, expect, mock, test } from "bun:test";
import {
	EmptySkeletonError,
	JSONParseError,
	Planner,
	ZodValidationError,
} from "../tasks/planner.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_SKELETON_JSON = JSON.stringify([
	{
		title: "Database schema",
		description: "Create PostgreSQL tables and run migrations",
		acceptance_criteria: ["bun test passes"],
		provider: "claude",
	},
	{
		title: "Auth service",
		description: "Implement JWT-based authentication",
		acceptance_criteria: ["bun test passes", "POST /auth/login returns 200"],
		provider: "claude",
	},
	{
		title: "API endpoints",
		description: "Wire up REST endpoints for OAuth flow",
		acceptance_criteria: ["bun test passes"],
	},
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockCallClaude(planner: Planner, output: string) {
	// @ts-expect-error — accessing private method for testing
	planner.callClaude = mock(async () => output);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Planner.fromSkeletonSpec", () => {
	test("returns PlanSkeleton with correct structure for valid LLM output", async () => {
		const planner = new Planner();
		mockCallClaude(planner, VALID_SKELETON_JSON);

		const skeleton = await planner.fromSkeletonSpec("Add OAuth login");
		expect(skeleton.goal).toBe("Add OAuth login");
		expect(skeleton.nodes).toHaveLength(3);
		expect(skeleton.nodes[0]?.title).toBe("Database schema");
		expect(skeleton.nodes[0]?.status).toBe("pending");
		expect(skeleton.id).toBeTruthy();
		expect(skeleton.created_at).toBeTruthy();
	});

	test("throws EmptySkeletonError when LLM returns empty array", async () => {
		const planner = new Planner();
		mockCallClaude(planner, "[]");

		expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(
			EmptySkeletonError,
		);
	});

	test("throws ZodValidationError when LLM returns array with wrong schema", async () => {
		const planner = new Planner();
		// Missing required 'title' field
		mockCallClaude(
			planner,
			JSON.stringify([
				{ description: "missing title", acceptance_criteria: ["test"] },
			]),
		);

		expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(
			ZodValidationError,
		);
	});

	test("throws JSONParseError when LLM returns non-JSON garbage", async () => {
		const planner = new Planner();
		mockCallClaude(planner, "Sorry, I cannot help with that.");

		expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(
			JSONParseError,
		);
	});

	test("sets all nodes to pending status", async () => {
		const planner = new Planner();
		mockCallClaude(planner, VALID_SKELETON_JSON);

		const skeleton = await planner.fromSkeletonSpec("Add OAuth login");
		for (const node of skeleton.nodes) {
			expect(node.status).toBe("pending");
		}
	});
});

describe("Planner.estimateCost", () => {
	test("returns string with dollar range", () => {
		const planner = new Planner();
		const estimate = planner.estimateCost(5);
		expect(estimate).toMatch(/^\~\$[\d.]+-[\d.]+/);
		expect(estimate).toContain("±50%");
	});

	test("scales with node count", () => {
		const planner = new Planner();
		const small = planner.estimateCost(2);
		const large = planner.estimateCost(7);
		// Extract first number from each estimate
		const smallVal = Number.parseFloat(small.replace("~$", ""));
		const largeVal = Number.parseFloat(large.replace("~$", ""));
		expect(largeVal).toBeGreaterThan(smallVal);
	});
});

describe("Planner provider dispatch", () => {
	test("uses codex planner transport when provider is codex", async () => {
		const planner = new Planner();
		// @ts-expect-error — testing private transport dispatch
		planner.callCodexCli = mock(async () => VALID_SKELETON_JSON);

		const skeleton = await planner.fromSkeletonSpec("Add OAuth login", "codex");

		expect(skeleton.nodes).toHaveLength(3);
		// @ts-expect-error — testing private transport dispatch
		expect(planner.callCodexCli).toHaveBeenCalledTimes(1);
	});

	test("skips recursive decomposition for codex ask plans", async () => {
		const planner = new Planner();
		// @ts-expect-error — testing planner orchestration
		planner.fromSkeletonSpec = mock(async () => ({
			id: "skeleton_1",
			goal: "Rewrite README",
			created_at: "2026-04-09T00:00:00.000Z",
			nodes: [
				{
					id: "node_1",
					title: "Rewrite content",
					description: "Refresh the README structure and copy",
					acceptance_criteria: ["README is updated"],
					status: "pending",
				},
			],
		}));
		planner.shouldDecompose = mock(async () => true);

		const plan = await planner.buildAskPlan("Rewrite README", "codex");

		expect(plan.root_nodes).toHaveLength(1);
		expect(plan.root_nodes[0]?.sub_nodes).toBeUndefined();
		expect(planner.shouldDecompose).not.toHaveBeenCalled();
	});

	test("passes provider through handoff summary generation", async () => {
		const planner = new Planner();
		// @ts-expect-error — testing private transport dispatch
		planner.callKimiCli = mock(async () => "handoff summary");

		const summary = await planner.generateHandoffSummary(
			"Auth service",
			"1. Implement login\n2. Verify session storage",
			"kimi",
		);

		expect(summary).toBe("handoff summary");
		// @ts-expect-error — testing private transport dispatch
		expect(planner.callKimiCli).toHaveBeenCalledTimes(1);
	});
});
