import { expect, test, describe } from "bun:test";
import { TaskSchema } from "../schema/task.schema.ts";

describe("TaskSchema", () => {
  const validTask = {
    task_id: "task_abc123",
    goal: "Implement feature X",
    steps: [
      { id: 1, desc: "Write code", status: "pending" },
      { id: 2, desc: "Write tests", status: "pending" },
    ],
    acceptance_criteria: ["All tests pass", "No lint errors"],
    tests_required: true,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  test("parses valid task", () => {
    const result = TaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });

  test("rejects missing goal", () => {
    const { goal: _g, ...noGoal } = validTask;
    const result = TaskSchema.safeParse(noGoal);
    expect(result.success).toBe(false);
  });

  test("rejects empty steps", () => {
    const result = TaskSchema.safeParse({ ...validTask, steps: [] });
    expect(result.success).toBe(false);
  });

  test("rejects invalid status", () => {
    const result = TaskSchema.safeParse({ ...validTask, status: "unknown" });
    expect(result.success).toBe(false);
  });

  test("accepts optional fields absent", () => {
    const result = TaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBeUndefined();
      expect(result.data.priority).toBeUndefined();
    }
  });
});
