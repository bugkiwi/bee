export type AskPlanStatus = "planning" | "ready" | "running" | "done" | "failed";
export type AskPlanNodeStatus = "pending" | "planning" | "running" | "done" | "failed";

/**
 * A node in the recursive Ask plan tree.
 *
 * Leaf nodes have leaf_task_ids (executable tasks in .bee/tasks/).
 * Branch nodes have sub_nodes (further decomposed).
 */
export interface AskPlanNode {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  depth: number; // 0 = root level, increments with recursion
  status: AskPlanNodeStatus;
  /** Set when this node is further decomposed into sub-nodes */
  sub_nodes?: AskPlanNode[];
  /** Set when this node is a leaf — references task IDs in .bee/tasks/ */
  leaf_task_ids?: string[];
}

/**
 * Full Ask plan tree, persisted to .bee/plans/ask-{id}.json.
 *
 * Created during decomposition phase, updated during execution.
 */
export interface AskPlan {
  id: string;
  goal: string;
  created_at: string;
  updated_at: string;
  status: AskPlanStatus;
  root_nodes: AskPlanNode[];
}
