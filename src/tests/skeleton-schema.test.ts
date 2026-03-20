import { expect, test, describe } from "bun:test";
import { PlanSkeletonSchema, SkeletonSpecArraySchema } from "../schema/skeleton.schema.ts";

const validNode = {
  id: "node_001",
  title: "Database schema",
  description: "Create PostgreSQL tables and migrations",
  acceptance_criteria: ["bun test passes", "migration runs without error"],
  status: "pending" as const,
};

const validSkeleton = {
  id: "skeleton_abc",
  goal: "Add OAuth login",
  created_at: new Date().toISOString(),
  nodes: [validNode],
};

describe("PlanSkeletonSchema", () => {
  test("parses valid skeleton", () => {
    const result = PlanSkeletonSchema.safeParse(validSkeleton);
    expect(result.success).toBe(true);
  });

  test("rejects empty nodes array", () => {
    const result = PlanSkeletonSchema.safeParse({ ...validSkeleton, nodes: [] });
    expect(result.success).toBe(false);
  });

  test("rejects more than 7 nodes", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ ...validNode, id: `node_${i}` }));
    const result = PlanSkeletonSchema.safeParse({ ...validSkeleton, nodes });
    expect(result.success).toBe(false);
  });

  test("rejects invalid node status", () => {
    const result = PlanSkeletonSchema.safeParse({
      ...validSkeleton,
      nodes: [{ ...validNode, status: "unknown" }],
    });
    expect(result.success).toBe(false);
  });

  test("accepts all valid node statuses", () => {
    for (const status of ["pending", "running", "done", "failed"] as const) {
      const result = PlanSkeletonSchema.safeParse({
        ...validSkeleton,
        nodes: [{ ...validNode, status }],
      });
      expect(result.success).toBe(true);
    }
  });

  test("accepts optional depends_on and provider", () => {
    const withOptionals = {
      ...validSkeleton,
      nodes: [{ ...validNode, depends_on: ["node_000"], provider: "codex" }],
    };
    const result = PlanSkeletonSchema.safeParse(withOptionals);
    expect(result.success).toBe(true);
  });
});

describe("SkeletonSpecArraySchema (LLM output)", () => {
  const validSpec = {
    title: "Auth service",
    description: "Implement JWT auth",
    acceptance_criteria: ["bun test passes"],
  };

  test("parses valid spec array", () => {
    const result = SkeletonSpecArraySchema.safeParse([validSpec]);
    expect(result.success).toBe(true);
  });

  test("rejects empty array", () => {
    const result = SkeletonSpecArraySchema.safeParse([]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("0 nodes");
    }
  });

  test("rejects more than 7 specs", () => {
    const specs = Array.from({ length: 8 }, () => validSpec);
    const result = SkeletonSpecArraySchema.safeParse(specs);
    expect(result.success).toBe(false);
  });

  test("rejects spec with empty acceptance_criteria", () => {
    const result = SkeletonSpecArraySchema.safeParse([{ ...validSpec, acceptance_criteria: [] }]);
    expect(result.success).toBe(false);
  });
});
