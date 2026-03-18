import { z } from "zod";
import { TaskStatusSchema } from "./task.schema.ts";

export const RunRecordSchema = z.object({
  run_id: z.string(),
  task_id: z.string(),
  trace_id: z.string(),
  provider: z.string(),
  started_at: z.string(),
  completed_at: z.string().optional(),
  attempt: z.number().int().nonnegative(),
  provider_run_id: z.string().optional(),
  cost_usd: z.number().nonnegative().optional(),
  tokens_input: z.number().int().nonnegative().optional(),
  tokens_output: z.number().int().nonnegative().optional(),
  verification_result: z.enum(["pass", "fail"]).optional(),
  error: z.string().optional(),
});

export const StateFileSchema = z.object({
  task_id: z.string(),
  current_status: TaskStatusSchema,
  runs: z.array(RunRecordSchema),
  last_verified_at: z.string().optional(),
  verification_errors: z.array(z.string()).optional(),
});
