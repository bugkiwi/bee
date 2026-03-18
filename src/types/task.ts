export type TaskStatus =
  | "pending"
  | "running"
  | "verifying"
  | "done"
  | "failed"
  | "retrying";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface Step {
  id: number;
  desc: string;
  status: StepStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface Task {
  task_id: string;
  goal: string;
  steps: Step[];
  acceptance_criteria: string[];
  tests_required: boolean;
  status: TaskStatus;
  provider?: string;
  priority?: number;
  created_at: string;
  updated_at: string;
  spec_file?: string;
  working_dir?: string;
  timeout_ms?: number;
  runtime_check_cmd?: string;
}
