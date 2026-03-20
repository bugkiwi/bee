import { expect, test, describe, mock } from "bun:test";
import { Planner, EmptySkeletonError, ZodValidationError, JSONParseError } from "../tasks/planner.ts";

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
    expect(skeleton.nodes[0]!.title).toBe("Database schema");
    expect(skeleton.nodes[0]!.status).toBe("pending");
    expect(skeleton.id).toBeTruthy();
    expect(skeleton.created_at).toBeTruthy();
  });

  test("throws EmptySkeletonError when LLM returns empty array", async () => {
    const planner = new Planner();
    mockCallClaude(planner, "[]");

    expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(EmptySkeletonError);
  });

  test("throws ZodValidationError when LLM returns array with wrong schema", async () => {
    const planner = new Planner();
    // Missing required 'title' field
    mockCallClaude(planner, JSON.stringify([{ description: "missing title", acceptance_criteria: ["test"] }]));

    expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(ZodValidationError);
  });

  test("throws JSONParseError when LLM returns non-JSON garbage", async () => {
    const planner = new Planner();
    mockCallClaude(planner, "Sorry, I cannot help with that.");

    expect(planner.fromSkeletonSpec("Add OAuth login")).rejects.toBeInstanceOf(JSONParseError);
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
    const smallVal = parseFloat(small.replace("~$", ""));
    const largeVal = parseFloat(large.replace("~$", ""));
    expect(largeVal).toBeGreaterThan(smallVal);
  });
});
