import { z } from "zod";

export const StepStatusSchema = z.enum(["pending", "running", "done", "failed"]);

export const TaskStatusSchema = z.enum([
  "pending",
  "running",
  "verifying",
  "done",
  "failed",
  "retrying",
]);

export const StepSchema = z.object({
  id: z.number().int().positive(),
  desc: z.string().min(1),
  status: StepStatusSchema,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  error: z.string().optional(),
});

export const TaskSchema = z.object({
  task_id: z.string().min(1),
  goal: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  acceptance_criteria: z.array(z.string()),
  tests_required: z.boolean(),
  status: TaskStatusSchema,
  provider: z.string().optional(),
  priority: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  spec_file: z.string().optional(),
  working_dir: z.string().optional(),
  timeout_ms: z.number().positive().optional(),
  runtime_check_cmd: z.string().optional(),
});

export type TaskFromSchema = z.infer<typeof TaskSchema>;
