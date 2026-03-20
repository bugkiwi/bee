import stringWidth from "string-width";
import type { ContentLine } from "./types.ts";
import { MAX_HISTORY_ENTRIES, THINKING_SUMMARY_MAX } from "./types.ts";

export const CONTENT_LABEL_WIDTH = 9;
export const CONTENT_LABEL_GAP = 2;
export type MetaGroupType = "thinking" | "tool";

export function toInlineSummaryText(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").replace(/[^\S\r\n]+/g, " ").trim();
}

export function summarizeThinking(text: string): { summary: string; full: string; truncated: boolean } {
  const full = text.trimStart();
  const summarySource = toInlineSummaryText(full);
  const truncated = summarySource !== full || summarySource.length > THINKING_SUMMARY_MAX;
  if (summarySource.length <= THINKING_SUMMARY_MAX) {
    return { summary: summarySource, full, truncated };
  }
  return {
    summary: `${summarySource.slice(0, THINKING_SUMMARY_MAX)}…`,
    full,
    truncated,
  };
}

export function isGenericThinkingLine(text: string): boolean {
  const trimmed = text.trim();
  const withoutPrefix = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return /^thinking(?:\.{3}|…)?$/i.test(withoutPrefix);
}

export function isCollapsibleThinkingLine(text: string): boolean {
  if (isGenericThinkingLine(text)) return false;
  return /\S/.test(text);
}

export function getContentLineLabel(line: Pick<ContentLine, "type">): string | null {
  switch (line.type) {
    case "user":
      return "ASK";
    case "thinking":
      return "THINKING";
    case "tool":
      return "TOOL";
    case "error":
      return "ERROR";
    default:
      return null;
  }
}

export function hasContentLineLeadingColumn(line: Pick<ContentLine, "type">): boolean {
  switch (line.type) {
    case "user":
    case "assistant":
    case "thinking":
    case "tool":
    case "error":
      return true;
    default:
      return false;
  }
}

export function getContentLineText(line: Pick<ContentLine, "type" | "text">): string {
  switch (line.type) {
    case "user":
      return line.text.replace(/^\s*›\s*/, "").trimStart();
    case "thinking":
      return line.text.replace(/^\s*💭\s*/, "").trimStart();
    case "tool":
      return line.text.replace(/^\s*📖\s*/, "").trimStart();
    case "error":
    case "shell":
      return line.text.trimStart();
    default:
      return line.text;
  }
}

export function getContentLineBlocks(line: Pick<ContentLine, "type" | "text" | "meta">): string[] {
  const blocks = [getContentLineText(line)];
  if (line.meta?.kind === "tool-diff") {
    blocks.push(line.meta.patch);
  }
  return blocks.filter((block) => block.length > 0);
}

export function getCollapsibleMetaGroupType(line: Pick<ContentLine, "type" | "text">): MetaGroupType | null {
  if (line.type === "thinking" && isCollapsibleThinkingLine(line.text)) return "thinking";
  if (line.type === "tool" && /\S/.test(getContentLineText(line))) return "tool";
  return null;
}

export function getMetaGroupLabel(groupType: MetaGroupType): string {
  return groupType === "tool" ? "TOOL" : "THINKING";
}

export function summarizeMetaGroup<T extends Pick<ContentLine, "id" | "type" | "text">>(
  lines: T[]
): {
  summarySource: T | undefined;
  summary: string;
  full: string;
  truncated: boolean;
} {
  const summarySource =
    lines.find((line) => line.type === "thinking" && isCollapsibleThinkingLine(line.text)) ??
    lines.find((line) => line.type === "tool" && /\S/.test(getContentLineText(line))) ??
    lines[0];

  const summaryLineText = summarySource ? getContentLineText(summarySource) : "";
  return {
    summarySource,
    ...summarizeThinking(summaryLineText),
  };
}

export function getMetaSummaryLine(summary: string, expanded: boolean, isStreaming: boolean): string {
  const prefix = expanded ? "▼" : "▶";
  const spinner = isStreaming ? " ⠋" : "";
  return `${prefix}${spinner} [${summary}]`;
}

export function rowsForText(text: string, width: number): number {
  const w = Math.max(1, width);
  return Math.max(1, Math.ceil(stringWidth(text) / w));
}

export function rowsForBlock(text: string, width: number): number {
  const lines = text.split("\n");
  return lines.reduce((total, line) => total + rowsForText(line, width), 0);
}

export function getContentBodyWidth(termWidth: number, hasLabel: boolean): number {
  const width = Math.max(20, termWidth);
  if (!hasLabel) return width;
  return Math.max(1, width - CONTENT_LABEL_WIDTH - CONTENT_LABEL_GAP);
}

export function normalizeUserHistoryEntry(text: string): string | null {
  const withoutPrefix = text.replace(/^\s*›\s*/, "").trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

export function extractHistoryFromTranscript(lines: Array<{ type: string; text: string }>): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.type !== "user") continue;
    const normalized = normalizeUserHistoryEntry(line.text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    history.push(normalized);
    if (history.length >= MAX_HISTORY_ENTRIES) break;
  }
  return history;
}

export function createContentLine(id: string, text: string, type: ContentLine["type"]): ContentLine {
  return { id, text, type };
}
