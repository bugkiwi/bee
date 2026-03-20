import { z } from "zod";

export const SkeletonNodeStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
]);

export const SkeletonNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance_criteria: z.array(z.string()).min(1),
  depends_on: z.array(z.string()).optional(),
  provider: z.string().optional(),
  status: SkeletonNodeStatusSchema,
});

export const PlanSkeletonSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  created_at: z.string(),
  nodes: z.array(SkeletonNodeSchema).min(1).max(7),
});

/** Schema for the raw LLM output — an array of node specs (without status/id, added by planner) */
export const SkeletonNodeSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance_criteria: z.array(z.string()).min(1),
  depends_on: z.array(z.string()).optional(),
  provider: z.string().optional(),
});

export const SkeletonSpecArraySchema = z
  .array(SkeletonNodeSpecSchema)
  .min(1, "Plan returned 0 nodes")
  .max(7);
