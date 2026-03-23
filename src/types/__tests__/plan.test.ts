import { describe, it, expect } from "bun:test";
import {
  PlanStatus,
  type Plan,
  type PlanStep,
  type PlanTask,
  type PlanSummary,
} from "../plan";

describe("PlanStatus enum", () => {
  it("has all expected members", () => {
    expect(PlanStatus.pending as string).toBe("pending");
    expect(PlanStatus.running as string).toBe("running");
    expect(PlanStatus.paused as string).toBe("paused");
    expect(PlanStatus.completed as string).toBe("completed");
    expect(PlanStatus.failed as string).toBe("failed");
  });

  it("all values are strings", () => {
    for (const value of Object.values(PlanStatus)) {
      expect(typeof value).toBe("string");
    }
  });

  it("has exactly 5 members", () => {
    expect(Object.values(PlanStatus).length).toBe(5);
  });
});

describe("Plan interface fixture", () => {
  const fixturePlanStep: PlanStep = {
    id: "step-1",
    description: "First step",
    status: "pending",
    order: 1,
    startedAt: "2026-03-23T00:00:00Z",
    completedAt: undefined,
    error: undefined,
    metadata: { key: "value" },
  };

  const fixturePlanTask: PlanTask = {
    id: "task-1",
    title: "Task One",
    description: "Do something",
    status: PlanStatus.pending,
    order: 1,
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
    metadata: {},
  };

  const fixturePlan: Plan = {
    id: "plan-1",
    title: "Test Plan",
    description: "A plan for testing",
    status: PlanStatus.pending,
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
    tasks: [fixturePlanTask],
    steps: [fixturePlanStep],
    tags: ["test", "unit"],
    priority: 1,
    assignee: "user-1",
    metadata: { source: "test" },
  };

  it("has correct id", () => {
    expect(fixturePlan.id).toBe("plan-1");
  });

  it("has correct title and description", () => {
    expect(fixturePlan.title).toBe("Test Plan");
    expect(fixturePlan.description).toBe("A plan for testing");
  });

  it("has valid status from PlanStatus enum", () => {
    expect(Object.values(PlanStatus)).toContain(fixturePlan.status);
  });

  it("has tasks array", () => {
    expect(Array.isArray(fixturePlan.tasks)).toBe(true);
    expect(fixturePlan.tasks.length).toBeGreaterThan(0);
  });

  it("task has required fields", () => {
    const task = fixturePlan.tasks[0]!;
    expect(task.id).toBeDefined();
    expect(task.title).toBeDefined();
    expect(task.description).toBeDefined();
    expect(Object.values(PlanStatus)).toContain(task.status);
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();
  });

  it("step has required fields", () => {
    const step = fixturePlan.steps![0]!;
    expect(step.id).toBeDefined();
    expect(step.description).toBeDefined();
    expect(["pending", "in_progress", "completed", "failed", "skipped"]).toContain(step.status);
  });

  it("supports optional fields", () => {
    expect(fixturePlan.tags).toEqual(["test", "unit"]);
    expect(fixturePlan.priority).toBe(1);
    expect(fixturePlan.assignee).toBe("user-1");
    expect(fixturePlan.metadata).toBeDefined();
  });

  it("createdAt and updatedAt can be strings or Dates", () => {
    const planWithDates: Plan = {
      ...fixturePlan,
      createdAt: new Date("2026-03-23T00:00:00Z"),
      updatedAt: new Date("2026-03-23T00:00:00Z"),
    };
    expect(planWithDates.createdAt).toBeInstanceOf(Date);
    expect(planWithDates.updatedAt).toBeInstanceOf(Date);
  });
});

describe("PlanSummary interface fixture", () => {
  const fixtureSummary: PlanSummary = {
    id: "plan-1",
    title: "Test Plan",
    description: "A plan for testing",
    status: PlanStatus.completed,
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
    taskCount: 5,
  };

  it("has correct shape", () => {
    expect(fixtureSummary.id).toBe("plan-1");
    expect(fixtureSummary.taskCount).toBe(5);
    expect(fixtureSummary.status).toBe(PlanStatus.completed);
  });
});
