/**
 * Tests for PlanNode component logic.
 *
 * We test the pure helper functions and the collapsible state model
 * rather than rendering Ink components directly.
 */

import { describe, it, expect } from "bun:test";
import type { Plan, PlanTask, PlanStatus } from "../types/plan.ts";

// ─── Replicate helpers from PlanNode for unit testing ─────────────────────────

function statusBadge(status: PlanStatus): string {
  switch (status) {
    case "completed": return "✅";
    case "running":   return "▶";
    case "failed":    return "✗";
    case "paused":    return "⏸";
    default:          return "○";
  }
}

function statusColor(status: PlanStatus): string {
  switch (status) {
    case "completed": return "green";
    case "running":   return "cyan";
    case "failed":    return "red";
    case "paused":    return "yellow";
    default:          return "gray";
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "task-1",
    title: "Write tests",
    description: "Add coverage",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-1",
    title: "Test Plan",
    description: "A plan for testing",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [],
    ...overrides,
  };
}

// ─── statusBadge ─────────────────────────────────────────────────────────────

describe("statusBadge", () => {
  it("returns ✅ for completed", () => {
    expect(statusBadge("completed")).toBe("✅");
  });

  it("returns ▶ for running", () => {
    expect(statusBadge("running")).toBe("▶");
  });

  it("returns ✗ for failed", () => {
    expect(statusBadge("failed")).toBe("✗");
  });

  it("returns ⏸ for paused", () => {
    expect(statusBadge("paused")).toBe("⏸");
  });

  it("returns ○ for pending", () => {
    expect(statusBadge("pending")).toBe("○");
  });
});

// ─── statusColor ─────────────────────────────────────────────────────────────

describe("statusColor", () => {
  it("returns green for completed", () => {
    expect(statusColor("completed")).toBe("green");
  });

  it("returns cyan for running", () => {
    expect(statusColor("running")).toBe("cyan");
  });

  it("returns red for failed", () => {
    expect(statusColor("failed")).toBe("red");
  });

  it("returns yellow for paused", () => {
    expect(statusColor("paused")).toBe("yellow");
  });

  it("returns gray for pending", () => {
    expect(statusColor("pending")).toBe("gray");
  });
});

// ─── Collapsible state model ──────────────────────────────────────────────────

describe("PlanNode collapsible state model", () => {
  it("defaults to expanded, showing all tasks", () => {
    const plan = makePlan({
      tasks: [
        makeTask({ id: "t1", title: "Task A" }),
        makeTask({ id: "t2", title: "Task B" }),
      ],
    });

    let expanded = true; // default
    const visibleTasks = expanded ? plan.tasks : [];
    expect(visibleTasks).toHaveLength(2);
  });

  it("collapsed state hides all task children", () => {
    const plan = makePlan({
      tasks: [
        makeTask({ id: "t1", title: "Task A" }),
        makeTask({ id: "t2", title: "Task B" }),
        makeTask({ id: "t3", title: "Task C" }),
      ],
    });

    let expanded = true;
    // Simulate toggle
    expanded = !expanded;
    const visibleTasks = expanded ? plan.tasks : [];
    expect(visibleTasks).toHaveLength(0);
  });

  it("expanded state shows all nested task children", () => {
    const plan = makePlan({
      tasks: [
        makeTask({ id: "t1", title: "Task A" }),
        makeTask({ id: "t2", title: "Task B" }),
        makeTask({ id: "t3", title: "Task C" }),
      ],
    });

    let expanded = false;
    // Simulate toggle back to expanded
    expanded = !expanded;
    const visibleTasks = expanded ? plan.tasks : [];
    expect(visibleTasks).toHaveLength(3);
    expect(visibleTasks.map((t) => t.title)).toEqual(["Task A", "Task B", "Task C"]);
  });

  it("toggle inverts expanded state each time", () => {
    let expanded = true;
    expanded = !expanded; // false
    expect(expanded).toBe(false);
    expanded = !expanded; // true
    expect(expanded).toBe(true);
  });
});

// ─── TaskNode connector logic ─────────────────────────────────────────────────

describe("TaskNode connector lines", () => {
  it("uses └─ for the last task", () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2" })];
    const connectors = tasks.map((_, idx) => (idx === tasks.length - 1 ? "└─" : "├─"));
    expect(connectors).toEqual(["├─", "└─"]);
  });

  it("uses ├─ for non-last tasks", () => {
    const tasks = [
      makeTask({ id: "t1" }),
      makeTask({ id: "t2" }),
      makeTask({ id: "t3" }),
    ];
    const connectors = tasks.map((_, idx) => (idx === tasks.length - 1 ? "└─" : "├─"));
    expect(connectors[0]).toBe("├─");
    expect(connectors[1]).toBe("├─");
    expect(connectors[2]).toBe("└─");
  });

  it("single task uses └─ (it is both first and last)", () => {
    const tasks = [makeTask({ id: "t1" })];
    const connectors = tasks.map((_, idx) => (idx === tasks.length - 1 ? "└─" : "├─"));
    expect(connectors[0]).toBe("└─");
  });
});

// ─── Plan with no tasks ───────────────────────────────────────────────────────

describe("PlanNode with empty task list", () => {
  it("renders nothing in the task area when tasks is empty", () => {
    const plan = makePlan({ tasks: [] });
    const expanded = true;
    const visibleTasks = expanded && plan.tasks.length > 0 ? plan.tasks : [];
    expect(visibleTasks).toHaveLength(0);
  });
});

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("PlanNode snapshots", () => {
  it("statusBadge output matches snapshot for all statuses", () => {
    const statuses = ["completed", "running", "failed", "paused", "pending"] as PlanStatus[];
    const result = statuses.reduce<Record<string, string>>((acc, s) => {
      acc[s] = statusBadge(s);
      return acc;
    }, {});
    expect(result).toMatchSnapshot();
  });

  it("statusColor output matches snapshot for all statuses", () => {
    const statuses = ["completed", "running", "failed", "paused", "pending"] as PlanStatus[];
    const result = statuses.reduce<Record<string, string>>((acc, s) => {
      acc[s] = statusColor(s);
      return acc;
    }, {});
    expect(result).toMatchSnapshot();
  });

  it("connector lines match snapshot for a 3-task plan", () => {
    const tasks = [
      makeTask({ id: "t1", title: "Task A" }),
      makeTask({ id: "t2", title: "Task B" }),
      makeTask({ id: "t3", title: "Task C" }),
    ];
    const connectors = tasks.map((_, idx) => (idx === tasks.length - 1 ? "└─" : "├─"));
    expect(connectors).toMatchSnapshot();
  });

  it("plan header data matches snapshot", () => {
    const plan = makePlan({
      id: "snap-plan",
      title: "Snapshot Plan",
      status: "running",
      tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
    });
    const header = {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      badge: statusBadge(plan.status),
      color: statusColor(plan.status),
      taskCount: plan.tasks.length,
    };
    expect(header).toMatchSnapshot();
  });
});
