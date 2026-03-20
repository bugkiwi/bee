export type SkeletonNodeStatus = "pending" | "running" | "done" | "failed";

export interface SkeletonNode {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  depends_on?: string[];
  provider?: string;
  status: SkeletonNodeStatus;
}

export interface PlanSkeleton {
  id: string;
  goal: string;
  created_at: string;
  nodes: SkeletonNode[];
}

export type SkeletonProgressEvent =
  | { type: "node:start"; nodeId: string; title: string }
  | { type: "node:done"; nodeId: string; elapsed: number; summary: string }
  | { type: "leaf:start"; nodeId: string; leafId: string; goal: string }
  | { type: "leaf:done"; nodeId: string; leafId: string; success: boolean };
