import type { AgentTaskStatus as TaskStatus } from "../types/task.ts";

export type TransitionEvent =
  | "start"
  | "provider_success"
  | "provider_failure"
  | "verify_pass"
  | "verify_fail"
  | "retry"
  | "resume_run"
  | "resume_verify";

export type TransitionMap = Record<
  TaskStatus,
  Partial<Record<TransitionEvent, TaskStatus>>
>;

export const TRANSITIONS: TransitionMap = {
  pending: {
    start: "running",
  },
  running: {
    provider_success: "verifying",
    provider_failure: "failed",
  },
  verifying: {
    verify_pass: "done",
    verify_fail: "failed",
  },
  done: {},
  failed: {
    retry: "retrying",
  },
  retrying: {
    resume_run: "running",
  },
};

export const TERMINAL_STATES: TaskStatus[] = ["done", "failed"];
