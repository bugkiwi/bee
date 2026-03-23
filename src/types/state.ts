import type { AgentTaskStatus as TaskStatus } from "./task.ts";
import type { Plan } from "./plan.ts";
import type { Task } from "./task.ts";
import type { SubChat } from "./subchat.ts";

// ---------------------------------------------------------------------------
// UI state slices
// ---------------------------------------------------------------------------

/** Redux-style slice holding all plans, selection state, and async status. */
export interface PlansState {
  plans: Record<string, Plan>;
  selectedPlanId: string | null;
  loading: boolean;
  error: string | null;
}

/** Redux-style slice holding all orchestration tasks and the active task pointer. */
export interface TasksState {
  tasks: Record<string, Task>;
  activeTaskId: string | null;
  loading: boolean;
  error: string | null;
}

/** Redux-style slice holding all sub-chat threads and async status. */
export interface SubChatsState {
  subChats: Record<string, SubChat>;
  loading: boolean;
  error: string | null;
}

/** Root application state composed of plans, tasks, and sub-chat slices. */
export interface AppState {
  plans: PlansState;
  tasks: TasksState;
  subChats: SubChatsState;
}

// ---------------------------------------------------------------------------
// Agent execution state (legacy)
// ---------------------------------------------------------------------------

/** Persisted record of a single provider run attempt for a given task. */
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

/** On-disk state file aggregating all run attempts for a legacy agent task. */
export interface StateFile {
  task_id: string;
  current_status: TaskStatus;
  runs: RunRecord[];
  last_verified_at?: string;
  verification_errors?: string[];
}
