import { expect, test, describe } from "bun:test";
import { StateMachine } from "../state/machine.ts";
import type { AgentTaskStatus as TaskStatus } from "../types/task.ts";

describe("StateMachine", () => {
  const sm = new StateMachine();

  test("pending → running on start", () => {
    expect(sm.transition("pending", "start")).toBe("running");
  });

  test("running → verifying on provider_success", () => {
    expect(sm.transition("running", "provider_success")).toBe("verifying");
  });

  test("running → failed on provider_failure", () => {
    expect(sm.transition("running", "provider_failure")).toBe("failed");
  });

  test("verifying → done on verify_pass", () => {
    expect(sm.transition("verifying", "verify_pass")).toBe("done");
  });

  test("verifying → failed on verify_fail", () => {
    expect(sm.transition("verifying", "verify_fail")).toBe("failed");
  });

  test("failed → retrying on retry", () => {
    expect(sm.transition("failed", "retry")).toBe("retrying");
  });

  test("retrying → running on resume_run", () => {
    expect(sm.transition("retrying", "resume_run")).toBe("running");
  });

  test("throws on invalid transition", () => {
    expect(() => sm.transition("done", "start")).toThrow();
  });

  test("canTransition returns false for invalid", () => {
    expect(sm.canTransition("done", "start")).toBe(false);
  });

  test("isTerminal: done and failed are terminal", () => {
    expect(sm.isTerminal("done")).toBe(true);
    expect(sm.isTerminal("failed")).toBe(true);
  });

  test("isTerminal: others are not terminal", () => {
    const nonTerminal: TaskStatus[] = ["pending", "running", "verifying", "retrying"];
    for (const s of nonTerminal) {
      expect(sm.isTerminal(s)).toBe(false);
    }
  });
});
