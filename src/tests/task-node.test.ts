/**
 * Tests for TaskNode component helpers.
 *
 * Tests the pure helper functions (statusBadge, statusColor, stepProgress)
 * rather than rendering Ink components directly.
 */

import { describe, it, expect } from "bun:test";
import { TaskStatus, type Task, type TaskStep } from "../types/task.ts";
import { statusBadge, statusColor, stepProgress } from "../components/TaskNode.tsx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeStep(status: TaskStatus, id = "s1"): TaskStep {
  return { id, desc: "A step", status };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    planId: "plan-1",
    goal: "Write some code",
    steps: [],
    status: TaskStatus.pending,
    logLines: [],
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
    ...overrides,
  };
}

// ─── statusBadge ─────────────────────────────────────────────────────────────

describe("statusBadge", () => {
  it("returns ✅ for completed", () => {
    expect(statusBadge(TaskStatus.completed)).toBe("✅");
  });

  it("returns ▶ for running", () => {
    expect(statusBadge(TaskStatus.running)).toBe("▶");
  });

  it("returns ✗ for failed", () => {
    expect(statusBadge(TaskStatus.failed)).toBe("✗");
  });

  it("returns ⊘ for skipped", () => {
    expect(statusBadge(TaskStatus.skipped)).toBe("⊘");
  });

  it("returns ○ for pending", () => {
    expect(statusBadge(TaskStatus.pending)).toBe("○");
  });
});

// ─── statusColor ─────────────────────────────────────────────────────────────

describe("statusColor", () => {
  it("returns green for completed", () => {
    expect(statusColor(TaskStatus.completed)).toBe("green");
  });

  it("returns cyan for running", () => {
    expect(statusColor(TaskStatus.running)).toBe("cyan");
  });

  it("returns red for failed", () => {
    expect(statusColor(TaskStatus.failed)).toBe("red");
  });

  it("returns yellow for skipped", () => {
    expect(statusColor(TaskStatus.skipped)).toBe("yellow");
  });

  it("returns gray for pending", () => {
    expect(statusColor(TaskStatus.pending)).toBe("gray");
  });
});

// ─── stepProgress ─────────────────────────────────────────────────────────────

describe("stepProgress", () => {
  it("returns empty string when task has no steps", () => {
    const task = makeTask({ steps: [] });
    expect(stepProgress(task)).toBe("");
  });

  it("returns 0/N when no steps are done", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.pending, "s1"),
        makeStep(TaskStatus.running, "s2"),
        makeStep(TaskStatus.failed, "s3"),
      ],
    });
    expect(stepProgress(task)).toBe("0/3 steps");
  });

  it("counts completed steps correctly", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.completed, "s2"),
        makeStep(TaskStatus.pending, "s3"),
      ],
    });
    expect(stepProgress(task)).toBe("2/3 steps");
  });

  it("counts skipped steps as done", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.skipped, "s2"),
        makeStep(TaskStatus.pending, "s3"),
      ],
    });
    expect(stepProgress(task)).toBe("2/3 steps");
  });

  it("returns N/N when all steps are completed", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.completed, "s2"),
        makeStep(TaskStatus.completed, "s3"),
      ],
    });
    expect(stepProgress(task)).toBe("3/3 steps");
  });

  it("returns 0/1 for a single pending step", () => {
    const task = makeTask({
      steps: [makeStep(TaskStatus.pending, "s1")],
    });
    expect(stepProgress(task)).toBe("0/1 steps");
  });

  it("handles mix of all statuses", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.skipped,   "s2"),
        makeStep(TaskStatus.running,   "s3"),
        makeStep(TaskStatus.failed,    "s4"),
        makeStep(TaskStatus.pending,   "s5"),
      ],
    });
    // completed + skipped = 2 done out of 5
    expect(stepProgress(task)).toBe("2/5 steps");
  });
});

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("TaskNode snapshots", () => {
  it("statusBadge output matches snapshot for all TaskStatus values", () => {
    const result = Object.values(TaskStatus).reduce<Record<string, string>>((acc, s) => {
      acc[s] = statusBadge(s);
      return acc;
    }, {});
    expect(result).toMatchSnapshot();
  });

  it("statusColor output matches snapshot for all TaskStatus values", () => {
    const result = Object.values(TaskStatus).reduce<Record<string, string>>((acc, s) => {
      acc[s] = statusColor(s);
      return acc;
    }, {});
    expect(result).toMatchSnapshot();
  });

  it("stepProgress output matches snapshot for a representative task", () => {
    const task = makeTask({
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.skipped, "s2"),
        makeStep(TaskStatus.running, "s3"),
        makeStep(TaskStatus.pending, "s4"),
      ],
    });
    expect(stepProgress(task)).toMatchSnapshot();
  });

  it("task node data matches snapshot", () => {
    const task = makeTask({
      id: "snap-task",
      goal: "Deploy to production",
      status: TaskStatus.running,
      steps: [
        makeStep(TaskStatus.completed, "s1"),
        makeStep(TaskStatus.running, "s2"),
      ],
    });
    const snapshot = {
      id: task.id,
      goal: task.goal,
      status: task.status,
      badge: statusBadge(task.status),
      color: statusColor(task.status),
      progress: stepProgress(task),
    };
    expect(snapshot).toMatchSnapshot();
  });
});

// ─── TaskNode accepts Task type ───────────────────────────────────────────────

describe("TaskNode type compatibility", () => {
  it("accepts a minimal Task without optional fields", () => {
    const task = makeTask();
    expect(task.id).toBe("task-1");
    expect(task.goal).toBe("Write some code");
    expect(task.steps).toHaveLength(0);
    expect(task.status).toBe(TaskStatus.pending);
  });

  it("accepts a Task with all optional fields", () => {
    const task = makeTask({
      priority: 1,
      provider: "claude",
      metadata: { source: "agent" },
    });
    expect(task.priority).toBe(1);
    expect(task.provider).toBe("claude");
    expect(task.metadata).toEqual({ source: "agent" });
  });
});
