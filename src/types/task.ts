// ---------------------------------------------------------------------------
// Agent execution types (legacy — used by state machine and executor)
// ---------------------------------------------------------------------------

export type AgentTaskStatus =
	| "pending"
	| "running"
	| "verifying"
	| "done"
	| "failed"
	| "retrying";

export type StepStatus = "pending" | "running" | "done" | "failed";

/** A single step inside a legacy AgentTask, tracking execution state. */
export interface Step {
	id: number;
	desc: string;
	status: StepStatus;
	started_at?: string;
	completed_at?: string;
	error?: string;
}

/** Legacy agent task schema used by the state machine and executor. */
export interface AgentTask {
	task_id: string;
	goal: string;
	steps: Step[];
	acceptance_criteria: string[];
	tests_required: boolean;
	status: AgentTaskStatus;
	provider?: string;
	priority?: number;
	created_at: string;
	updated_at: string;
	spec_file?: string;
	working_dir?: string;
	timeout_ms?: number;
	runtime_check_cmd?: string;
}

// ---------------------------------------------------------------------------
// Orchestration task schema with step-level granularity and execution metadata
// ---------------------------------------------------------------------------

export enum TaskStatus {
	pending = "pending",
	running = "running",
	completed = "completed",
	failed = "failed",
	skipped = "skipped",
}

/** A fine-grained step inside an orchestration Task, with timing and error info. */
export interface TaskStep {
	id: string;
	desc: string;
	status: TaskStatus;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

/** An orchestration task linking a goal to its constituent steps and a parent plan. */
export interface Task {
	id: string;
	planId: string;
	goal: string;
	steps: TaskStep[];
	status: TaskStatus;
	logLines: string[];
	priority?: number;
	provider?: string;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	completedAt?: string;
	metadata?: Record<string, unknown>;
}

/** The outcome of a completed, failed, or skipped Task, capturing output and errors. */
export interface TaskResult {
	taskId: string;
	status: TaskStatus;
	output?: unknown;
	error?: string;
	errorCode?: string;
	completedAt: string;
	metadata?: Record<string, unknown>;
}
