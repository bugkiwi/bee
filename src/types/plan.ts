export type PlanStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

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

export interface Plan {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  createdAt: string | Date;
  status: PlanStatus;
  updatedAt?: string | Date;
  tags?: string[];
  priority?: number;
  assignee?: string;
  metadata?: Record<string, unknown>;
}
