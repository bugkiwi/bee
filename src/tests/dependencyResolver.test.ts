import { describe, expect, it } from "bun:test";
import {
  allDepsSatisfied,
  isDone,
  resolvePendingTasks,
  type ResolvableTask,
} from "../engine/dependencyResolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  id: string,
  status: ResolvableTask["status"],
  depends_on?: string[]
): ResolvableTask {
  return {
    task_id: id,
    goal: `goal-${id}`,
    steps: [],
    acceptance_criteria: [],
    tests_required: false,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(depends_on !== undefined ? { depends_on } : {}),
  };
}

// ---------------------------------------------------------------------------
// isDone
// ---------------------------------------------------------------------------

describe("isDone", () => {
  it("returns true for done tasks", () => {
    expect(isDone(makeTask("a", "done"))).toBe(true);
  });

  it("returns false for pending tasks", () => {
    expect(isDone(makeTask("a", "pending"))).toBe(false);
  });

  it("returns false for running tasks", () => {
    expect(isDone(makeTask("a", "running"))).toBe(false);
  });

  it("returns false for failed tasks", () => {
    expect(isDone(makeTask("a", "failed"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// allDepsSatisfied
// ---------------------------------------------------------------------------

describe("allDepsSatisfied", () => {
  it("returns true when depends_on is absent", () => {
    const task = makeTask("a", "pending");
    const map = new Map([["a", task]]);
    expect(allDepsSatisfied(task, map)).toBe(true);
  });

  it("returns true when depends_on is empty", () => {
    const task = makeTask("a", "pending", []);
    const map = new Map([["a", task]]);
    expect(allDepsSatisfied(task, map)).toBe(true);
  });

  it("returns true when all deps are done", () => {
    const dep = makeTask("dep", "done");
    const task = makeTask("a", "pending", ["dep"]);
    const map = new Map([
      ["dep", dep],
      ["a", task],
    ]);
    expect(allDepsSatisfied(task, map)).toBe(true);
  });

  it("returns false when a dep is pending", () => {
    const dep = makeTask("dep", "pending");
    const task = makeTask("a", "pending", ["dep"]);
    const map = new Map([
      ["dep", dep],
      ["a", task],
    ]);
    expect(allDepsSatisfied(task, map)).toBe(false);
  });

  it("returns false when a dep is running", () => {
    const dep = makeTask("dep", "running");
    const task = makeTask("a", "pending", ["dep"]);
    const map = new Map([
      ["dep", dep],
      ["a", task],
    ]);
    expect(allDepsSatisfied(task, map)).toBe(false);
  });

  it("returns false when a dep is missing from the map", () => {
    const task = makeTask("a", "pending", ["ghost"]);
    const map = new Map([["a", task]]);
    expect(allDepsSatisfied(task, map)).toBe(false);
  });

  it("returns false when only some deps are done", () => {
    const done = makeTask("d1", "done");
    const pending = makeTask("d2", "pending");
    const task = makeTask("a", "pending", ["d1", "d2"]);
    const map = new Map([
      ["d1", done],
      ["d2", pending],
      ["a", task],
    ]);
    expect(allDepsSatisfied(task, map)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolvePendingTasks
// ---------------------------------------------------------------------------

describe("resolvePendingTasks", () => {
  it("puts a task with no deps in ready", () => {
    const task = makeTask("a", "pending");
    const { ready, blocked } = resolvePendingTasks([task]);
    expect(ready).toEqual([task]);
    expect(blocked).toHaveLength(0);
  });

  it("puts a task with empty deps array in ready", () => {
    const task = makeTask("a", "pending", []);
    const { ready, blocked } = resolvePendingTasks([task]);
    expect(ready).toEqual([task]);
    expect(blocked).toHaveLength(0);
  });

  it("puts a task whose dep is done in ready", () => {
    const dep = makeTask("dep", "done");
    const task = makeTask("a", "pending", ["dep"]);
    const { ready, blocked } = resolvePendingTasks([dep, task]);
    expect(ready).toEqual([task]);
    expect(blocked).toHaveLength(0);
  });

  it("puts a task whose dep is pending in blocked", () => {
    const dep = makeTask("dep", "pending");
    const task = makeTask("a", "pending", ["dep"]);
    const { ready, blocked } = resolvePendingTasks([dep, task]);
    expect(blocked).toContain(task);
    // dep itself has no depends_on so it is ready
    expect(ready).toContain(dep);
  });

  it("excludes non-pending tasks from both sets", () => {
    const done = makeTask("d", "done");
    const running = makeTask("r", "running");
    const failed = makeTask("f", "failed");
    const { ready, blocked } = resolvePendingTasks([done, running, failed]);
    expect(ready).toHaveLength(0);
    expect(blocked).toHaveLength(0);
  });

  it("handles a mixed list correctly", () => {
    const a = makeTask("a", "done");
    const b = makeTask("b", "pending", ["a"]); // ready — dep done
    const c = makeTask("c", "pending", ["b"]); // blocked — dep b is pending
    const d = makeTask("d", "pending"); // ready — no deps

    const { ready, blocked } = resolvePendingTasks([a, b, c, d]);
    expect(ready).toContain(b);
    expect(ready).toContain(d);
    expect(blocked).toContain(c);
    expect(ready).not.toContain(c);
    expect(blocked).not.toContain(b);
    expect(blocked).not.toContain(d);
  });

  it("is pure — does not mutate input tasks", () => {
    const task = makeTask("a", "pending");
    const original = { ...task };
    resolvePendingTasks([task]);
    expect(task).toEqual(original);
  });

  it("re-evaluation: task moves to ready once dep becomes done", () => {
    const dep = makeTask("dep", "pending");
    const task = makeTask("a", "pending", ["dep"]);

    const r1 = resolvePendingTasks([dep, task]);
    expect(r1.blocked).toContain(task);

    // Simulate dep completing
    const depDone = { ...dep, status: "done" } as ResolvableTask;
    const r2 = resolvePendingTasks([depDone, task]);
    expect(r2.ready).toContain(task);
    expect(r2.blocked).toHaveLength(0);
  });

  it("returns empty sets for an empty input", () => {
    const { ready, blocked } = resolvePendingTasks([]);
    expect(ready).toHaveLength(0);
    expect(blocked).toHaveLength(0);
  });
});
