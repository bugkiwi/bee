import type { ToolDiffMeta } from "../types/transcript.ts";

const MAX_PATCH_LINES = 80;

function normalizeText(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n") : null;
}

function toLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n") && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function countBodyLines(lines: string[]): { addedLines: number; removedLines: number } {
  let addedLines = 0;
  let removedLines = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) addedLines++;
    if (line.startsWith("-") && !line.startsWith("---")) removedLines++;
  }
  return { addedLines, removedLines };
}

function truncatePatch(lines: string[]): { lines: string[]; truncated: boolean } {
  if (lines.length <= MAX_PATCH_LINES) return { lines, truncated: false };
  return {
    lines: [
      ...lines.slice(0, MAX_PATCH_LINES),
      `... ${lines.length - MAX_PATCH_LINES} more diff lines omitted ...`,
    ],
    truncated: true,
  };
}

function buildEditPatch(filePath: string, oldText: string, newText: string): ToolDiffMeta | null {
  if (oldText === newText) return null;

  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  const rawLines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ];
  const { lines, truncated } = truncatePatch(rawLines);
  const counts = countBodyLines(rawLines);
  return {
    kind: "tool-diff",
    filePath,
    patch: lines.join("\n"),
    truncated,
    ...counts,
  };
}

function buildWritePatch(filePath: string, content: string): ToolDiffMeta | null {
  const newLines = toLines(content);
  if (newLines.length === 0) return null;

  const rawLines = [
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${newLines.length} @@`,
    ...newLines.map((line) => `+${line}`),
  ];
  const { lines, truncated } = truncatePatch(rawLines);
  return {
    kind: "tool-diff",
    filePath,
    patch: lines.join("\n"),
    addedLines: newLines.length,
    removedLines: 0,
    truncated,
  };
}

export function summarizeToolDiff(meta: ToolDiffMeta): string {
  const delta = [`+${meta.addedLines}`];
  if (meta.removedLines > 0) delta.push(`-${meta.removedLines}`);
  const suffix = meta.truncated ? " · truncated" : "";
  return `${meta.filePath} (${delta.join(" ")}${suffix})`;
}

export function createToolDiffPreview(name: string, args: Record<string, unknown>): ToolDiffMeta | null {
  const filePath = normalizeText(args.file_path);
  if (!filePath) return null;

  if (name === "Edit") {
    const oldText = normalizeText(args.old_string);
    const newText = normalizeText(args.new_string);
    if (oldText === null || newText === null) return null;
    return buildEditPatch(filePath, oldText, newText);
  }

  if (name === "Write") {
    const content = normalizeText(args.content);
    if (content === null) return null;
    return buildWritePatch(filePath, content);
  }

  return null;
}
