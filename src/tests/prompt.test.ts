import { expect, test, describe } from "bun:test";
import { buildPrompt } from "../utils/prompt.ts";
import type { AgentTask as Task } from "../types/task.ts";

const baseTask: Task = {
  task_id: "task_abc",
  goal: "Write a hello world function",
  steps: [
    { id: 1, desc: "Create the function", status: "pending" },
    { id: 2, desc: "Write tests", status: "pending" },
  ],
  acceptance_criteria: ["Function returns 'hello world'", "Tests pass"],
  tests_required: true,
  status: "pending",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("buildPrompt", () => {
  test("includes task_id", () => {
    const prompt = buildPrompt(baseTask);
    expect(prompt).toContain("task_abc");
  });

  test("includes goal", () => {
    const prompt = buildPrompt(baseTask);
    expect(prompt).toContain("Write a hello world function");
  });

  test("includes all steps", () => {
    const prompt = buildPrompt(baseTask);
    expect(prompt).toContain("Create the function");
    expect(prompt).toContain("Write tests");
  });

  test("includes acceptance criteria", () => {
    const prompt = buildPrompt(baseTask);
    expect(prompt).toContain("Function returns 'hello world'");
    expect(prompt).toContain("Tests pass");
  });

  test("includes no-stop instruction", () => {
    const prompt = buildPrompt(baseTask);
    expect(prompt).toContain("EVERY step");
  });
});
