/**
 * AgentLoop skeleton execution tests.
 *
 * Exercises runSkeleton() control-flow directly by stubbing the Planner
 * and the private runNode method so no live LLM call is required.
 *
 * Four behaviours verified:
 *   1. All nodes execute in sequence (node order preserved)
 *   2. A failing node halts execution and throws NodeFailedError
 *   3. User declining the plan throws UserAbortError
 *   4. Nodes with status="done" are skipped (resume support)
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop, NodeFailedError, UserAbortError } from "../agent/loop.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";
import type { PlanSkeleton, SkeletonNode } from "../types/skeleton.ts";
import type { WorkspaceConfig } from "../types/config.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDirs(suffix: string) {
  const base = join(tmpdir(), `bee-skeleton-loop-${suffix}-${Date.now()}`);
  const dirs = {
    tasks: join(base, "tasks"),
    state: join(base, "state"),
    logs: join(base, "logs"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  return { base, dirs };
}

function makeMockSkeleton(nodeCount = 3, overrideStatuses: Record<number, string> = {}): PlanSkeleton {
  return {
    id: `skeleton-loop-test-${Date.now()}`,
    goal: "test goal",
    created_at: new Date().toISOString(),
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `node-${i + 1}`,
      title: `Test Node ${i + 1}`,
      description: `Description for node ${i + 1}`,
      acceptance_criteria: ["task completes"],
      status: (overrideStatuses[i] ?? "pending") as SkeletonNode["status"],
    })),
  };
}

const TEST_CONFIG: WorkspaceConfig = {
  ...DEFAULT_CONFIG,
  provider: "claude",
};

function makeLoop(dirs: ReturnType<typeof makeTempDirs>["dirs"]) {
  return new AgentLoop(TEST_CONFIG, dirs);
}

function stubPlanner(loop: AgentLoop, skeleton: PlanSkeleton) {
  (loop as unknown as Record<string, unknown>)["planner"] = {
    fromSkeletonSpec: async () => skeleton,
    estimateCost: () => "~$0.60-1.00 (±50%)",
    generateHandoffSummary: async () => "mock handoff summary",
    generateLeafTasks: async () => [],
  };
}

type RunNodeFn = (
  node: SkeletonNode,
  handoff: string,
  provider: string,
  ...rest: unknown[]
) => Promise<string>;

function stubRunNode(loop: AgentLoop, fn: RunNodeFn) {
  (loop as unknown as Record<string, unknown>)["runNode"] = fn;
}

// ── Describe blocks ───────────────────────────────────────────────────────────

describe("runSkeleton — node execution order", () => {
  let dirs: ReturnType<typeof makeTempDirs>;

  beforeEach(() => { dirs = makeTempDirs("order"); });
  afterEach(() => { rmSync(dirs.base, { recursive: true, force: true }); });

  test("executes all nodes sequentially in skeleton order", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(3);
    stubPlanner(loop, skeleton);

    const executedIds: string[] = [];
    stubRunNode(loop, async (node) => {
      executedIds.push(node.id);
      return `summary for ${node.id}`;
    });

    await loop.runSkeleton("test goal", {
      onSkeletonReady: async () => true,
    });

    expect(executedIds).toEqual(["node-1", "node-2", "node-3"]);
  });

  test("passes handoff summary from each node to the next", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(3);
    stubPlanner(loop, skeleton);

    const receivedHandoffs: string[] = [];
    stubRunNode(loop, async (node, handoff) => {
      receivedHandoffs.push(handoff);
      return `result-${node.id}`;
    });

    await loop.runSkeleton("test goal", {
      onSkeletonReady: async () => true,
    });

    // First node gets empty handoff, subsequent get previous node's result
    expect(receivedHandoffs[0]).toBe("");
    expect(receivedHandoffs[1]).toBe("result-node-1");
    expect(receivedHandoffs[2]).toBe("result-node-2");
  });
});

describe("runSkeleton — node failure", () => {
  let dirs: ReturnType<typeof makeTempDirs>;

  beforeEach(() => { dirs = makeTempDirs("fail"); });
  afterEach(() => { rmSync(dirs.base, { recursive: true, force: true }); });

  test("halts on node failure and throws NodeFailedError", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(3);
    stubPlanner(loop, skeleton);

    const executedIds: string[] = [];
    stubRunNode(loop, async (node) => {
      executedIds.push(node.id);
      if (node.id === "node-2") throw new Error("simulated node failure");
      return `summary for ${node.id}`;
    });

    await expect(
      loop.runSkeleton("test goal", { onSkeletonReady: async () => true })
    ).rejects.toBeInstanceOf(NodeFailedError);

    // node-3 must NOT have been reached after node-2 failed
    expect(executedIds).toEqual(["node-1", "node-2"]);
    expect(executedIds).not.toContain("node-3");
  });

  test("NodeFailedError carries the failing node's title", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(2);
    stubPlanner(loop, skeleton);

    stubRunNode(loop, async (node) => {
      if (node.id === "node-1") throw new Error("disk error");
      return "ok";
    });

    let caught: unknown;
    try {
      await loop.runSkeleton("test goal", { onSkeletonReady: async () => true });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NodeFailedError);
    expect((caught as NodeFailedError).nodeTitle).toBe("Test Node 1");
  });
});

describe("runSkeleton — user abort", () => {
  let dirs: ReturnType<typeof makeTempDirs>;

  beforeEach(() => { dirs = makeTempDirs("abort"); });
  afterEach(() => { rmSync(dirs.base, { recursive: true, force: true }); });

  test("throws UserAbortError when onSkeletonReady returns false", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(3);
    stubPlanner(loop, skeleton);

    const executedIds: string[] = [];
    stubRunNode(loop, async (node) => {
      executedIds.push(node.id);
      return "ok";
    });

    await expect(
      loop.runSkeleton("test goal", { onSkeletonReady: async () => false })
    ).rejects.toBeInstanceOf(UserAbortError);

    // No nodes should have been executed after abort
    expect(executedIds).toHaveLength(0);
  });

  test("proceeds normally when onSkeletonReady returns true", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(1);
    stubPlanner(loop, skeleton);
    stubRunNode(loop, async () => "ok");

    await expect(
      loop.runSkeleton("test goal", { onSkeletonReady: async () => true })
    ).resolves.toBeUndefined();
  });
});

describe("runSkeleton — resume skips completed nodes", () => {
  let dirs: ReturnType<typeof makeTempDirs>;

  beforeEach(() => { dirs = makeTempDirs("resume"); });
  afterEach(() => { rmSync(dirs.base, { recursive: true, force: true }); });

  test("skips nodes that already have status='done'", async () => {
    const loop = makeLoop(dirs.dirs);
    // node-1 (index 0) is already done; nodes 2 and 3 are pending
    const skeleton = makeMockSkeleton(3, { 0: "done" });
    stubPlanner(loop, skeleton);

    const executedIds: string[] = [];
    stubRunNode(loop, async (node) => {
      executedIds.push(node.id);
      return `summary for ${node.id}`;
    });

    await loop.runSkeleton("test goal", { onSkeletonReady: async () => true });

    expect(executedIds).not.toContain("node-1");
    expect(executedIds).toEqual(["node-2", "node-3"]);
  });

  test("completes immediately when all nodes are already done", async () => {
    const loop = makeLoop(dirs.dirs);
    const skeleton = makeMockSkeleton(3, { 0: "done", 1: "done", 2: "done" });
    stubPlanner(loop, skeleton);

    const executedIds: string[] = [];
    stubRunNode(loop, async (node) => {
      executedIds.push(node.id);
      return "ok";
    });

    await loop.runSkeleton("test goal", { onSkeletonReady: async () => true });

    expect(executedIds).toHaveLength(0);
  });
});
