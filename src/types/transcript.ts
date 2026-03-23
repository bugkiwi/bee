/** Metadata attached to a tool-call diff entry in the transcript display. */
export interface ToolDiffMeta {
  kind: "tool-diff";
  filePath: string;
  patch: string;
  addedLines: number;
  removedLines: number;
  truncated: boolean;
}

export type TranscriptLineMeta = ToolDiffMeta;
