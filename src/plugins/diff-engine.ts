export interface DiffResult {
  applied: string[];
  failed: string[];
  summary: string;
}

/**
 * Extract unified diff blocks from provider output text.
 * Looks for fenced code blocks tagged `diff` OR untagged blocks whose content
 * starts with `--- a/` or `+++ b/`.
 */
export function extractDiffs(text: string): string[] {
  const diffs: string[] = [];

  // Match fenced code blocks: ```diff ... ``` or ``` ... ``` where content looks like a diff
  const fencePattern = /```(?:diff)?\n([\s\S]*?)```/g;
  for (const m of text.matchAll(fencePattern)) {
    const body = m[1] ?? "";
    if (
      body.includes("--- a/") ||
      body.includes("+++ b/") ||
      body.startsWith("--- ") ||
      body.startsWith("+++ ")
    ) {
      diffs.push(body.trimEnd());
    }
  }

  return diffs;
}

/**
 * Parse the filename from a diff block header line like `--- a/src/foo.ts`.
 */
function parseDiffFilename(diffBlock: string): string | null {
  for (const line of diffBlock.split("\n")) {
    const m = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

/**
 * Apply a single diff block using the `patch` shell command.
 * Returns true on success.
 */
async function applyDiff(diffBlock: string, workDir: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["patch", "-p1", "-d", workDir], {
      stdin: new TextEncoder().encode(diffBlock + "\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export class DiffEngine {
  async apply(output: string, workDir: string): Promise<DiffResult> {
    const diffs = extractDiffs(output);
    const applied: string[] = [];
    const failed: string[] = [];

    for (const diff of diffs) {
      const filename = parseDiffFilename(diff) ?? "unknown";
      const ok = await applyDiff(diff, workDir);
      if (ok) {
        applied.push(filename);
      } else {
        failed.push(filename);
      }
    }

    const total = applied.length + failed.length;
    const summary =
      total === 0
        ? "No diffs found in output."
        : `Applied ${applied.length}/${total} diff(s).${failed.length > 0 ? ` Failed: ${failed.join(", ")}` : ""}`;

    return { applied, failed, summary };
  }
}
