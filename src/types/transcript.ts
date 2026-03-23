import type { Plan } from "./plan.ts";

/** Metadata attached to a tool-call diff entry in the transcript display. */
export interface ToolDiffMeta {
  kind: "tool-diff";
  filePath: string;
  patch: string;
  addedLines: number;
  removedLines: number;
  truncated: boolean;
}

/** Metadata attached to a rich plan preview rendered inline in the chat transcript. */
export interface PlanPreviewMeta {
  kind: "plan-preview";
  sourcePath: string;
  plan: Plan;
}

export type TranscriptLineMeta = ToolDiffMeta | PlanPreviewMeta;
