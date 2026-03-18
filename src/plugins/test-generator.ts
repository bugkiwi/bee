import type { Task } from "../types/task.ts";

export interface TestGeneratorResult {
  files: string[];
  skipped: boolean;
}

const TEST_SYSTEM_PROMPT =
  "You are a test-first engineer. Write ONLY test code — no implementation. " +
  "Generate comprehensive tests that verify the acceptance criteria. " +
  "Use the bun:test framework (import { expect, test, describe } from 'bun:test'). " +
  "Output test code inside a fenced code block tagged `ts`. " +
  "Do NOT include any implementation code or explanations outside code blocks.";

/**
 * Extract fenced code blocks from text.
 */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/g;
  for (const m of text.matchAll(pattern)) {
    const body = (m[1] ?? "").trim();
    if (body.length > 0) {
      blocks.push(body);
    }
  }
  return blocks;
}

/**
 * Spawn claude to generate tests for a task.
 */
async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const proc = Bun.spawn(
      [
        "claude",
        "--print",
        "--output-format",
        "json",
        "--system-prompt",
        systemPrompt,
        userPrompt,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const raw = await new Response(proc.stdout).text();
    await proc.exited;

    // Try to parse JSON output (claude --output-format json wraps in { result: "..." })
    try {
      const parsed = JSON.parse(raw) as { result?: string; type?: string };
      if (parsed.result) return parsed.result;
    } catch {
      // Fall through to raw text
    }
    return raw;
  } catch {
    return "";
  }
}

export class TestGenerator {
  async generate(task: Task, workDir: string): Promise<TestGeneratorResult> {
    if (!task.tests_required) {
      return { files: [], skipped: true };
    }

    const criteria = task.acceptance_criteria.map((c) => `- ${c}`).join("\n");
    const steps = task.steps.map((s) => `  ${s.id}. ${s.desc}`).join("\n");

    const userPrompt =
      `Generate tests for the following task.\n\n` +
      `## Goal\n${task.goal}\n\n` +
      `## Steps\n${steps}\n\n` +
      `## Acceptance Criteria\n${criteria}\n\n` +
      `Write tests that verify each acceptance criterion.`;

    const output = await callClaude(TEST_SYSTEM_PROMPT, userPrompt);
    const codeBlocks = extractCodeBlocks(output);

    if (codeBlocks.length === 0) {
      return { files: [], skipped: false };
    }

    const writtenFiles: string[] = [];

    for (let i = 0; i < codeBlocks.length; i++) {
      const suffix = codeBlocks.length === 1 ? "" : `.${i + 1}`;
      const filename = `${task.task_id}${suffix}.test.ts`;
      const absPath = `${workDir}/${filename}`;
      try {
        await Bun.write(absPath, codeBlocks[i] + "\n");
        writtenFiles.push(absPath);
      } catch {
        // Skip files that can't be written
      }
    }

    return { files: writtenFiles, skipped: false };
  }
}
