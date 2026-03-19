import stringWidth from "string-width";
import type { ContentLine } from "./types.ts";
import { MAX_HISTORY_ENTRIES, THINKING_SUMMARY_MAX } from "./types.ts";

export function summarizeThinking(text: string): { summary: string; full: string; truncated: boolean } {
  const full = text.trimStart();
  if (full.length <= THINKING_SUMMARY_MAX) {
    return { summary: full, full, truncated: false };
  }
  return {
    summary: `${full.slice(0, THINKING_SUMMARY_MAX)}…`,
    full,
    truncated: true,
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

export function rowsForText(text: string, width: number): number {
  const w = Math.max(1, width);
  return Math.max(1, Math.ceil(stringWidth(text) / w));
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
