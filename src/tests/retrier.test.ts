import { expect, test, describe } from "bun:test";
import { Retrier } from "../agent/retrier.ts";
import type { StateFile } from "../types/state.ts";

function makeState(runCount: number): StateFile {
  return {
    task_id: "task_test",
    current_status: "failed",
    runs: Array.from({ length: runCount }, (_, i) => ({
      run_id: `run_${i}`,
      task_id: "task_test",
      trace_id: `trace_${i}`,
      provider: "claude",
      started_at: new Date().toISOString(),
      attempt: i,
    })),
  };
}

describe("Retrier", () => {
  const retrier = new Retrier({ max_attempts: 3, backoff_ms: 100, backoff_multiplier: 2, jitter: false });

  test("shouldRetry returns true when under max attempts", () => {
    expect(retrier.shouldRetry(makeState(0))).toBe(true);
    expect(retrier.shouldRetry(makeState(1))).toBe(true);
    expect(retrier.shouldRetry(makeState(2))).toBe(true);
  });

  test("shouldRetry returns false at max attempts", () => {
    expect(retrier.shouldRetry(makeState(3))).toBe(false);
    expect(retrier.shouldRetry(makeState(5))).toBe(false);
  });

  test("attemptCount matches run count", () => {
    expect(retrier.attemptCount(makeState(2))).toBe(2);
  });
});
