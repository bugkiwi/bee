import { describe, it, expect } from "bun:test";
import { TaskStatus, type TaskStep, type Task, type TaskResult } from "../task";

// ---------------------------------------------------------------------------
// TaskStatus enum
// ---------------------------------------------------------------------------

describe("TaskStatus enum", () => {
  it("has all expected members", () => {
    expect(TaskStatus.pending as string).toBe("pending");
    expect(TaskStatus.running as string).toBe("running");
    expect(TaskStatus.completed as string).toBe("completed");
    expect(TaskStatus.failed as string).toBe("failed");
    expect(TaskStatus.skipped as string).toBe("skipped");
  });

  it("covers exactly 5 members", () => {
    const values = Object.values(TaskStatus) as string[];
    expect(values).toHaveLength(5);
    expect(values).toEqual(["pending", "running", "completed", "failed", "skipped"]);
  });
});

// ---------------------------------------------------------------------------
// TaskStep structural fixture
// ---------------------------------------------------------------------------

describe("TaskStep structure", () => {
  const fixture: TaskStep = {
    id: "step-1",
    desc: "Run unit tests",
    status: TaskStatus.pending,
  };

  it("has required fields id, desc, status", () => {
    expect(fixture.id).toBe("step-1");
    expect(fixture.desc).toBe("Run unit tests");
    expect(fixture.status).toBe(TaskStatus.pending);
  });

  it("optional fields are absent when not provided", () => {
    expect(fixture.startedAt).toBeUndefined();
    expect(fixture.completedAt).toBeUndefined();
    expect(fixture.error).toBeUndefined();
    expect(fixture.metadata).toBeUndefined();
  });

  it("accepts optional fields", () => {
    const running: TaskStep = {
      id: "step-3",
      desc: "Build",
      status: TaskStatus.running,
      startedAt: "2026-03-23T00:00:00Z",
      completedAt: "2026-03-23T00:01:00Z",
      error: undefined,
      metadata: { retries: 1 },
    };
    expect(running.startedAt).toBe("2026-03-23T00:00:00Z");
    expect(running.completedAt).toBe("2026-03-23T00:01:00Z");
    expect(running.metadata).toEqual({ retries: 1 });
  });

  it("accepts failed status with error message", () => {
    const step: TaskStep = {
      id: "step-4",
      desc: "Verify",
      status: TaskStatus.failed,
      error: "timeout",
    };
    expect(step.status).toBe(TaskStatus.failed);
    expect(step.error).toBe("timeout");
  });
});

// ---------------------------------------------------------------------------
// Task structural fixture
// ---------------------------------------------------------------------------

describe("Task structure", () => {
  const step: TaskStep = {
    id: "s1",
    desc: "init",
    status: TaskStatus.completed,
  };

  const fixture: Task = {
    id: "task-abc",
    planId: "plan-xyz",
    goal: "Write tests",
    steps: [step],
    status: TaskStatus.pending,
    logLines: [],
    createdAt: "2026-03-23T00:00:00Z",
    updatedAt: "2026-03-23T00:00:00Z",
  };

  it("has all required fields", () => {
    expect(fixture.id).toBe("task-abc");
    expect(fixture.planId).toBe("plan-xyz");
    expect(fixture.goal).toBe("Write tests");
    expect(fixture.steps).toHaveLength(1);
    expect(fixture.status).toBe(TaskStatus.pending);
    expect(fixture.createdAt).toBe("2026-03-23T00:00:00Z");
    expect(fixture.updatedAt).toBe("2026-03-23T00:00:00Z");
  });

  it("steps array contains valid TaskStep objects", () => {
    const s = fixture.steps[0]!;
    expect(s.id).toBe("s1");
    expect(s.desc).toBe("init");
    expect(s.status).toBe(TaskStatus.completed);
  });

  it("optional fields absent when not provided", () => {
    expect(fixture.priority).toBeUndefined();
    expect(fixture.provider).toBeUndefined();
    expect(fixture.metadata).toBeUndefined();
  });

  it("logLines defaults to empty array", () => {
    expect(fixture.logLines).toEqual([]);
  });

  it("logLines accepts string entries", () => {
    const withLogs: Task = { ...fixture, logLines: ["line 1", "line 2"] };
    expect(withLogs.logLines).toEqual(["line 1", "line 2"]);
  });

  it("accepts optional fields", () => {
    const full: Task = {
      ...fixture,
      priority: 1,
      provider: "claude",
      metadata: { source: "test" },
    };
    expect(full.priority).toBe(1);
    expect(full.provider).toBe("claude");
    expect(full.metadata).toEqual({ source: "test" });
  });
});

// ---------------------------------------------------------------------------
// TaskResult — success and error variants
// ---------------------------------------------------------------------------

describe("TaskResult structure", () => {
  it("captures a success payload", () => {
    const result: TaskResult = {
      taskId: "task-abc",
      status: TaskStatus.completed,
      output: { linesChanged: 42 },
      completedAt: "2026-03-23T01:00:00Z",
    };
    expect(result.taskId).toBe("task-abc");
    expect(result.status).toBe(TaskStatus.completed);
    expect(result.output).toEqual({ linesChanged: 42 });
    expect(result.completedAt).toBe("2026-03-23T01:00:00Z");
    expect(result.error).toBeUndefined();
    expect(result.errorCode).toBeUndefined();
  });

  it("captures a failure with error and errorCode", () => {
    const result: TaskResult = {
      taskId: "task-def",
      status: TaskStatus.failed,
      error: "execution timeout",
      errorCode: "TIMEOUT",
      completedAt: "2026-03-23T02:00:00Z",
    };
    expect(result.status).toBe(TaskStatus.failed);
    expect(result.error).toBe("execution timeout");
    expect(result.errorCode).toBe("TIMEOUT");
    expect(result.output).toBeUndefined();
  });

  it("captures a skipped result", () => {
    const result: TaskResult = {
      taskId: "task-ghi",
      status: TaskStatus.skipped,
      completedAt: "2026-03-23T03:00:00Z",
    };
    expect(result.status).toBe(TaskStatus.skipped);
    expect(result.error).toBeUndefined();
    expect(result.output).toBeUndefined();
  });

  it("accepts metadata on result", () => {
    const result: TaskResult = {
      taskId: "task-jkl",
      status: TaskStatus.completed,
      completedAt: "2026-03-23T04:00:00Z",
      metadata: { durationMs: 1500 },
    };
    expect(result.metadata).toEqual({ durationMs: 1500 });
  });
});
