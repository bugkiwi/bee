import type { Task } from "../types/task.ts";

export interface ContextFile {
  path: string;
  content: string;
  reason: string;
}

const MAX_FILES = 20;
const MAX_LINES_PER_FILE = 150;

/**
 * Extract file-like tokens (paths, module names, function names) from text.
 */
function extractKeywords(text: string): string[] {
  const keywords: Set<string> = new Set();

  // File paths: e.g. src/foo/bar.ts, ./utils/id, ../types/task
  const pathPattern = /(?:\.{0,2}\/)?[\w-]+(?:\/[\w-]+)*(?:\.\w+)?/g;
  for (const m of text.matchAll(pathPattern)) {
    const token = m[0].replace(/^\.+\//, "");
    if (token.length > 2 && !token.startsWith("-")) {
      keywords.add(token);
    }
  }

  // CamelCase identifiers (class/function names)
  const camelPattern = /\b[A-Z][a-zA-Z0-9]{2,}\b/g;
  for (const m of text.matchAll(camelPattern)) {
    keywords.add(m[0]);
  }

  // snake_case identifiers
  const snakePattern = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/g;
  for (const m of text.matchAll(snakePattern)) {
    keywords.add(m[0]);
  }

  return [...keywords].filter((k) => k.length > 2);
}

/**
 * Run a git command and return stdout, or empty string on failure.
 */
async function gitChangedFiles(workDir: string, args: string[]): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return [];
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read up to MAX_LINES_PER_FILE lines from a file.
 */
async function readFileCapped(absPath: string): Promise<string | null> {
  try {
    const file = Bun.file(absPath);
    const text = await file.text();
    const lines = text.split("\n");
    if (lines.length <= MAX_LINES_PER_FILE) return text;
    return lines.slice(0, MAX_LINES_PER_FILE).join("\n") + "\n... (truncated)";
  } catch {
    return null;
  }
}

export class ContextSelector {
  async select(task: Task, workDir: string): Promise<ContextFile[]> {
    const collected = new Map<string, ContextFile>();

    // 1. Extract keywords from goal and step descriptions
    const taskText = [
      task.goal,
      ...task.steps.map((s) => s.desc),
      ...task.acceptance_criteria,
    ].join(" ");
    const keywords = extractKeywords(taskText);

    // 2. Get recently changed files from git
    const [headChanged, head1Changed] = await Promise.all([
      gitChangedFiles(workDir, ["diff", "--name-only", "HEAD"]),
      gitChangedFiles(workDir, ["diff", "--name-only", "HEAD~1"]),
    ]);

    const recentFiles = [...new Set([...headChanged, ...head1Changed])];
    for (const relPath of recentFiles) {
      if (collected.size >= MAX_FILES) break;
      const absPath = `${workDir}/${relPath}`;
      const content = await readFileCapped(absPath);
      if (content !== null) {
        collected.set(relPath, {
          path: relPath,
          content,
          reason: "recently changed (git diff)",
        });
      }
    }

    // 3. Glob for files matching keywords
    if (keywords.length > 0 && collected.size < MAX_FILES) {
      const glob = new Bun.Glob("**/*.{ts,js,tsx,jsx,json,md,py,go,rs,sh}");
      const allFiles: string[] = [];
      for await (const file of glob.scan({ cwd: workDir, absolute: false })) {
        allFiles.push(file);
      }

      for (const keyword of keywords) {
        if (collected.size >= MAX_FILES) break;
        // Normalize keyword for matching
        const normalizedKw = keyword.toLowerCase().replace(/[_-]/g, "");
        for (const relPath of allFiles) {
          if (collected.size >= MAX_FILES) break;
          if (collected.has(relPath)) continue;

          const fileBasename = relPath
            .split("/")
            .pop()!
            .toLowerCase()
            .replace(/[_.\-]/g, "");

          if (
            fileBasename.includes(normalizedKw) ||
            relPath.toLowerCase().includes(keyword.toLowerCase())
          ) {
            const absPath = `${workDir}/${relPath}`;
            const content = await readFileCapped(absPath);
            if (content !== null) {
              collected.set(relPath, {
                path: relPath,
                content,
                reason: `matches keyword "${keyword}"`,
              });
            }
          }
        }
      }
    }

    return [...collected.values()];
  }
}

/**
 * Format a list of context files into a markdown section suitable for appending to a prompt.
 */
export function formatContextForPrompt(files: ContextFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    const ext = f.path.split(".").pop() ?? "";
    const fence = ext ? `\`\`\`${ext}` : "```";
    return `### ${f.path}\n_Reason: ${f.reason}_\n\n${fence}\n${f.content}\n\`\`\``;
  });

  return `## Context Files\n\n${sections.join("\n\n")}`;
}
