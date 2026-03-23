import { describe, it, expect } from "bun:test";
import type {
  AppState,
  PlansState,
  TasksState,
  SubChatsState,
} from "../state.ts";
import { PlanStatus } from "../plan.ts";
import { TaskStatus } from "../task.ts";
import { MessageRole } from "../subchat.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyPlansState: PlansState = {
  plans: {},
  selectedPlanId: null,
  loading: false,
  error: null,
};

const emptyTasksState: TasksState = {
  tasks: {},
  activeTaskId: null,
  loading: false,
  error: null,
};

const emptySubChatsState: SubChatsState = {
  subChats: {},
  loading: false,
  error: null,
};

const emptyAppState: AppState = {
  plans: emptyPlansState,
  tasks: emptyTasksState,
  subChats: emptySubChatsState,
};

const fixtureAppState: AppState = {
  plans: {
    plans: {
      "plan-1": {
        id: "plan-1",
        title: "Test Plan",
        description: "A plan for testing",
        status: PlanStatus.running,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        tasks: [
          {
            id: "ptask-1",
            title: "Plan Task 1",
            description: "First plan task",
            status: PlanStatus.pending,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
        steps: [
          {
            id: "step-1",
            description: "First step",
            status: "in_progress",
          },
        ],
        tags: ["ci"],
        priority: 1,
      },
    },
    selectedPlanId: "plan-1",
    loading: false,
    error: null,
  },
  tasks: {
    tasks: {
      "task-1": {
        id: "task-1",
        planId: "plan-1",
        goal: "Write tests",
        steps: [
          {
            id: "tstep-1",
            desc: "Create file",
            status: TaskStatus.completed,
            completedAt: "2026-01-01T01:00:00Z",
          },
        ],
        status: TaskStatus.running,
        logLines: [],
        priority: 2,
        provider: "claude",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T01:00:00Z",
      },
    },
    activeTaskId: "task-1",
    loading: true,
    error: null,
  },
  subChats: {
    subChats: {
      "subchat-1": {
        id: "subchat-1",
        taskId: "task-1",
        planId: "plan-1",
        messages: [
          {
            id: "msg-1",
            role: MessageRole.user,
            content: "Hello",
            timestamp: new Date("2026-01-01T00:00:00Z"),
          },
          {
            id: "msg-2",
            role: MessageRole.assistant,
            content: "Hi there",
            timestamp: new Date("2026-01-01T00:00:01Z"),
          },
        ],
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:01Z"),
      },
    },
    loading: false,
    error: "network timeout",
  },
};

// ---------------------------------------------------------------------------
// Tests: PlansState slice
// ---------------------------------------------------------------------------

describe("PlansState", () => {
  it("has loading field", () => {
    expect(typeof fixtureAppState.plans.loading).toBe("boolean");
  });

  it("has error field", () => {
    expect(fixtureAppState.plans.error).toBeNull();
  });

  it("has plans record", () => {
    expect(typeof fixtureAppState.plans.plans).toBe("object");
    expect(fixtureAppState.plans.plans["plan-1"]!.id).toBe("plan-1");
  });

  it("has selectedPlanId", () => {
    expect(fixtureAppState.plans.selectedPlanId).toBe("plan-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: TasksState slice
// ---------------------------------------------------------------------------

describe("TasksState", () => {
  it("has loading field", () => {
    expect(fixtureAppState.tasks.loading).toBe(true);
  });

  it("has error field", () => {
    expect(fixtureAppState.tasks.error).toBeNull();
  });

  it("has tasks record", () => {
    expect(typeof fixtureAppState.tasks.tasks).toBe("object");
    expect(fixtureAppState.tasks.tasks["task-1"]!.id).toBe("task-1");
  });

  it("has activeTaskId", () => {
    expect(fixtureAppState.tasks.activeTaskId).toBe("task-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: SubChatsState slice
// ---------------------------------------------------------------------------

describe("SubChatsState", () => {
  it("has loading field", () => {
    expect(typeof fixtureAppState.subChats.loading).toBe("boolean");
  });

  it("has error field (non-null)", () => {
    expect(fixtureAppState.subChats.error).toBe("network timeout");
  });

  it("has subChats record", () => {
    expect(typeof fixtureAppState.subChats.subChats).toBe("object");
    expect(fixtureAppState.subChats.subChats["subchat-1"]!.id).toBe("subchat-1");
  });

  it("subchat messages are populated", () => {
    const msgs = fixtureAppState.subChats.subChats["subchat-1"]!.messages;
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.role).toBe(MessageRole.user);
    expect(msgs[1]!.role).toBe(MessageRole.assistant);
  });
});

// ---------------------------------------------------------------------------
// Tests: AppState composite
// ---------------------------------------------------------------------------

describe("AppState fixture covers all slices", () => {
  it("has plans slice", () => {
    expect(fixtureAppState.plans).toBeDefined();
  });

  it("has tasks slice", () => {
    expect(fixtureAppState.tasks).toBeDefined();
  });

  it("has subChats slice", () => {
    expect(fixtureAppState.subChats).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Empty initial state
// ---------------------------------------------------------------------------

describe("empty initial AppState", () => {
  it("plans record is empty", () => {
    expect(Object.keys(emptyAppState.plans.plans)).toHaveLength(0);
  });

  it("plans loading is false", () => {
    expect(emptyAppState.plans.loading).toBe(false);
  });

  it("plans error is null", () => {
    expect(emptyAppState.plans.error).toBeNull();
  });

  it("plans selectedPlanId is null", () => {
    expect(emptyAppState.plans.selectedPlanId).toBeNull();
  });

  it("tasks record is empty", () => {
    expect(Object.keys(emptyAppState.tasks.tasks)).toHaveLength(0);
  });

  it("tasks loading is false", () => {
    expect(emptyAppState.tasks.loading).toBe(false);
  });

  it("tasks error is null", () => {
    expect(emptyAppState.tasks.error).toBeNull();
  });

  it("tasks activeTaskId is null", () => {
    expect(emptyAppState.tasks.activeTaskId).toBeNull();
  });

  it("subChats record is empty", () => {
    expect(Object.keys(emptyAppState.subChats.subChats)).toHaveLength(0);
  });

  it("subChats loading is false", () => {
    expect(emptyAppState.subChats.loading).toBe(false);
  });

  it("subChats error is null", () => {
    expect(emptyAppState.subChats.error).toBeNull();
  });
});
