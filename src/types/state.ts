import type { TaskStatus } from "./task.ts";

export interface RunRecord {
  run_id: string;
  task_id: string;
  trace_id: string;
  provider: string;
  started_at: string;
  completed_at?: string;
  attempt: number;
  provider_run_id?: string;
  cost_usd?: number;
  tokens_input?: number;
  tokens_output?: number;
  verification_result?: "pass" | "fail";
  error?: string;
}

export interface StateFile {
  task_id: string;
  current_status: TaskStatus;
  runs: RunRecord[];
  last_verified_at?: string;
  verification_errors?: string[];
}
