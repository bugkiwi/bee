import { expect, test, describe } from "bun:test";
import { generateTaskId, generateTraceId, generateRunId } from "../utils/id.ts";

describe("ID generation", () => {
  test("generateTaskId starts with task_", () => {
    expect(generateTaskId()).toMatch(/^task_[a-f0-9]+$/);
  });

  test("generateTraceId starts with trace_", () => {
    expect(generateTraceId()).toMatch(/^trace_[a-f0-9]+$/);
  });

  test("generateRunId starts with run_", () => {
    expect(generateRunId()).toMatch(/^run_[a-f0-9]+$/);
  });

  test("IDs are unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId()));
    expect(ids.size).toBe(100);
  });
});
