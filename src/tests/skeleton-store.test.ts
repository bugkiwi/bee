import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkeletonStore } from "../state/skeleton.ts";
import type { PlanSkeleton } from "../types/skeleton.ts";

function makeSkeleton(overrides: Partial<PlanSkeleton> = {}): PlanSkeleton {
  return {
    id: "skeleton_test001",
    goal: "Add OAuth login",
    created_at: new Date().toISOString(),
    nodes: [
      {
        id: "node_001",
        title: "Database schema",
        description: "Create tables",
        acceptance_criteria: ["bun test passes"],
        status: "pending",
      },
      {
        id: "node_002",
        title: "Auth service",
        description: "Implement JWT",
        acceptance_criteria: ["bun test passes"],
        status: "pending",
      },
    ],
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "bee-skeleton-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("SkeletonStore", () => {
  test("save and load round-trips correctly", async () => {
    const store = new SkeletonStore(tmpDir);
    const sk = makeSkeleton();
    await store.save(sk);
    const loaded = await store.load(sk.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(sk.id);
    expect(loaded!.goal).toBe(sk.goal);
    expect(loaded!.nodes).toHaveLength(2);
  });

  test("load returns null for missing skeleton", async () => {
    const store = new SkeletonStore(tmpDir);
    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });

  test("markNodeDone updates node status", async () => {
    const store = new SkeletonStore(tmpDir);
    const sk = makeSkeleton();
    await store.save(sk);
    await store.markNodeDone(sk.id, "node_001");
    const loaded = await store.load(sk.id);
    expect(loaded!.nodes.find((n) => n.id === "node_001")!.status).toBe("done");
    expect(loaded!.nodes.find((n) => n.id === "node_002")!.status).toBe("pending");
  });

  test("markNodeRunning updates node status", async () => {
    const store = new SkeletonStore(tmpDir);
    const sk = makeSkeleton();
    await store.save(sk);
    await store.markNodeRunning(sk.id, "node_001");
    const loaded = await store.load(sk.id);
    expect(loaded!.nodes.find((n) => n.id === "node_001")!.status).toBe("running");
  });

  test("markNodeFailed updates node status", async () => {
    const store = new SkeletonStore(tmpDir);
    const sk = makeSkeleton();
    await store.save(sk);
    await store.markNodeFailed(sk.id, "node_001");
    const loaded = await store.load(sk.id);
    expect(loaded!.nodes.find((n) => n.id === "node_001")!.status).toBe("failed");
  });

  test("listIncomplete returns only incomplete skeletons", async () => {
    const store = new SkeletonStore(tmpDir);

    // Skeleton with all done
    const done = makeSkeleton({ id: "skeleton_done" });
    done.nodes.forEach((n) => (n.status = "done"));
    await store.save(done);

    // Skeleton with one pending
    const partial = makeSkeleton({ id: "skeleton_partial" });
    partial.nodes[0]!.status = "done";
    await store.save(partial);

    // Skeleton fully pending
    const pending = makeSkeleton({ id: "skeleton_pending" });
    await store.save(pending);

    const incomplete = await store.listIncomplete();
    const ids = incomplete.map((s) => s.id);
    expect(ids).not.toContain("skeleton_done");
    expect(ids).toContain("skeleton_partial");
    expect(ids).toContain("skeleton_pending");
  });

  test("markNode throws for unknown nodeId", async () => {
    const store = new SkeletonStore(tmpDir);
    const sk = makeSkeleton();
    await store.save(sk);
    expect(store.markNodeDone(sk.id, "nonexistent_node")).rejects.toThrow("Node not found");
  });

  test("markNode throws for unknown skeletonId", async () => {
    const store = new SkeletonStore(tmpDir);
    expect(store.markNodeDone("nonexistent", "node_001")).rejects.toThrow("Skeleton not found");
  });

  test("save rethrows non-ENOSPC write errors unchanged", async () => {
    // Point stateDir at a path that cannot be written (file as parent)
    const store = new SkeletonStore("/dev/null/not-a-dir");
    const sk = makeSkeleton();
    // Should throw but NOT wrap as "Disk full" (only ENOSPC gets that treatment)
    expect(store.save(sk)).rejects.toThrow();
    expect(store.save(sk)).rejects.not.toThrow("Disk full");
  });
});
