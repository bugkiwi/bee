/**
 * Plan-Mode Auto-Exit Reproduction Tests
 *
 * Documents and verifies the exact conditions that cause plan mode to exit
 * automatically (without completing all nodes). Three triggers exist:
 *
 *   1. UserAbortError  — user types 'n' at the confirmation prompt (process.exit(0))
 *   2. NodeFailedError — any node execution fails (process.exit(1))
 *   3. Normal exit     — all nodes complete successfully (clean return)
 *
 * These tests exercise the control-flow paths directly by stubbing the Planner
 * so no live LLM call is required.
 */

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop, UserAbortError, NodeFailedError } from "../agent/loop.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";
import type { AskPlan } from "../types/ask-plan.ts";
import type { WorkspaceConfig } from "../types/config.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTempDirs(suffix: string) {
  const base = join(tmpdir(), `bee-autoexit-test-${suffix}-${Date.now()}`);
  const dirs = {
    tasks: join(base, "tasks"),
    state: join(base, "state"),
    logs: join(base, "logs"),
    plans: join(base, "plans"),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  return { base, dirs };
}

function makeMockPlan(id = "plan-001"): AskPlan {
  return {
    id,
    goal: "test goal",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "ready",
    root_nodes: [
      {
        id: "node-001",
        title: "Test Leaf Node",
        description: "A leaf node for testing",
        acceptance_criteria: ["task completes"],
        depth: 0,
        status: "pending",
        // No sub_nodes → leaf node
      },
    ],
  };
}

const TEST_CONFIG: WorkspaceConfig = {
  ...DEFAULT_CONFIG,
  provider: "claude",
};

function makeLoop(dirs: ReturnType<typeof makeTempDirs>["dirs"]) {
  const loop = new AgentLoop(TEST_CONFIG, dirs);
  return loop;
}

// Stub the private planner to return a fixed plan without LLM
function stubPlanner(loop: AgentLoop, plan: AskPlan) {
  (loop as unknown as Record<string, unknown>)["planner"] = {
    buildAskPlan: async () => plan,
  };
}

// ── Trigger 1: UserAbortError ─────────────────────────────────────────────────
// Sequence: buildAskPlan → save → onPlanReady returns false → updateStatus("planning") → throw UserAbortError

describe("Plan-mode auto-exit: UserAbortError", () => {
  let dirs: ReturnType<typeof makeTempDirs>;

  beforeEach(() => {
    dirs = makeTempDirs("abort");
  });

  afterEach(() => {
    rmSync(dirs.base, { recursive: true, force: true });
  });

  test("Run 1 — throws UserAbortError when onPlanReady returns false", async () => {
    const loop = makeLoop(dirs.dirs);
    stubPlanner(loop, makeMockPlan("plan-run1"));

    await expect(
      loop.runAsk("test goal", {
        onPlanReady: async (_plan) => false, // simulate user typing 'n'
      })
    ).rejects.toBeInstanceOf(UserAbortError);
  });

  test("Run 2 — plan status set to 'planning' before UserAbortError", async () => {
    const { AskPlanStore } = await import("../state/ask-plan.ts");
    const store = new AskPlanStore(dirs.dirs.plans);
    const loop = makeLoop(dirs.dirs);
    const plan = makeMockPlan("plan-run2");
    stubPlanner(loop, plan);

    let threw = false;
    try {
      await loop.runAsk("test goal", {
        onPlanReady: async (_plan) => false,
      });
    } catch (err) {
      threw = err instanceof UserAbortError;
    }

    expect(threw).toBe(true);
    // Verify plan was saved and status was set to "planning" (not "running" or "failed")
    const saved = await store.load(plan.id);
    expect(saved).not.toBeNull();
    expect(saved!.status).toBe("planning");
  });

  test("Run 3 — UserAbortError is raised for each invocation independently", async () => {
    const loop = makeLoop(dirs.dirs);
    stubPlanner(loop, makeMockPlan("plan-run3"));

    const errors: Error[] = [];
    for (let i = 0; i < 3; i++) {
      // Re-stub with unique plan ID each time
      stubPlanner(loop, makeMockPlan(`plan-run3-iter${i}`));
      try {
        await loop.runAsk(`goal ${i}`, { onPlanReady: async () => false });
      } catch (err) {
        if (err instanceof Error) errors.push(err);
      }
    }

    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e instanceof UserAbortError)).toBe(true);
  });
});

// ── Trigger 2: Normal exit (all nodes done) ───────────────────────────────────
// This path requires node execution (LLM), so we verify the type discrimination:
// a successful runAsk resolves (no throw), and the plan file status becomes "done".

describe("Plan-mode auto-exit: normal completion", () => {
  test("runAsk with no onPlanReady hook defaults to proceed=true (auto-confirm path)", async () => {
    const dirs = makeTempDirs("normal");
    try {
      const loop = makeLoop(dirs.dirs);
      // Stub planner AND executor so no LLM call happens
      const plan = makeMockPlan("plan-normal");
      stubPlanner(loop, plan);

      // Also stub runNode so node execution is a no-op
      (loop as unknown as Record<string, unknown>)["runNode"] = async () => "mock handoff";

      // No onPlanReady = skip approval gate entirely → proceeds to execute
      // But sessionStore.init() will try to read state files — stub it too
      (loop as unknown as Record<string, unknown>)["sessionStore"] = {
        init: async () => ({ active_provider: "claude" }),
      };

      // Should resolve (no throw) because all nodes complete
      await expect(loop.runAsk("test goal")).resolves.toBeUndefined();

      // Verify plan marked done
      const { AskPlanStore } = await import("../state/ask-plan.ts");
      const store = new AskPlanStore(dirs.dirs.plans);
      const saved = await store.load(plan.id);
      expect(saved?.status).toBe("done");
    } finally {
      rmSync(dirs.base, { recursive: true, force: true });
    }
  });
});
