import { z } from "zod";

const AskPlanNodeStatusSchema = z.enum(["pending", "planning", "running", "done", "failed"]);

// Recursive schema — Zod requires lazy() for self-referential types
const AskPlanNodeSchemaBase = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()),
  depth: z.number().int().min(0),
  status: AskPlanNodeStatusSchema,
  leaf_task_ids: z.array(z.string()).optional(),
});

export type AskPlanNodeInput = z.input<typeof AskPlanNodeSchemaBase> & {
  sub_nodes?: AskPlanNodeInput[];
};

export const AskPlanNodeSchema: z.ZodType<AskPlanNodeInput> = AskPlanNodeSchemaBase.extend({
  sub_nodes: z.lazy(() => z.array(AskPlanNodeSchema)).optional(),
});

export const AskPlanSchema = z.object({
  id: z.string(),
  goal: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  status: z.enum(["planning", "ready", "running", "done", "failed"]),
  root_nodes: z.array(AskPlanNodeSchema),
});
