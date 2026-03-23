export const PlanStatus = {
	pending: "pending",
	running: "running",
	paused: "paused",
	completed: "completed",
	failed: "failed",
} as const;

export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

export type PlanStepStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "skipped";

/** A single executable step within a plan, tracking progress and timing. */
export interface PlanStep {
	id: string;
	description: string;
	status: PlanStepStatus;
	order?: number;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

/** A discrete unit of work belonging to a plan, with its own lifecycle status. */
export interface PlanTask {
	id: string;
	title: string;
	description: string;
	status: PlanStatus;
	kind?: "plan" | "task";
	children?: PlanTask[];
	detailLines?: string[];
	order?: number;
	createdAt: string;
	updatedAt: string;
	metadata?: Record<string, unknown>;
}

/** Top-level plan record grouping tasks and steps under a shared goal. */
export interface Plan {
	id: string;
	title: string;
	description: string;
	status: PlanStatus;
	createdAt: string | Date;
	updatedAt: string | Date;
	tasks: PlanTask[];
	steps?: PlanStep[];
	tags?: string[];
	priority?: number;
	assignee?: string;
	metadata?: Record<string, unknown>;
}

/** Lightweight read-only view of a Plan used in list/index contexts. */
export interface PlanSummary {
	id: string;
	title: string;
	description: string;
	status: PlanStatus;
	createdAt: string | Date;
	updatedAt: string | Date;
	taskCount: number;
}
