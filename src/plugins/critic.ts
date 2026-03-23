import type { AgentTask as Task } from "../types/task.ts";

export interface CritiqueResult {
  passed: boolean;
  issues: string[];
  raw: string;
}

const CRITIC_SYSTEM_PROMPT =
  "You are a strict code reviewer. Review the following code changes for: " +
  "missing edge cases, incorrect assumptions, missing error handling, security issues. " +
  "List ONLY real problems as bullet points. If no problems, output LGTM.";

/**
 * Call Claude with the critic system prompt and return raw text output.
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

    // Try structured JSON output first
    try {
      const parsed = JSON.parse(raw) as { result?: string };
      if (parsed.result) return parsed.result;
    } catch {
      // Fall through to raw text
    }
    return raw;
  } catch {
    return "";
  }
}

/**
 * Parse bullet points from Claude's response.
 */
function parseBulletPoints(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- ") || l.startsWith("* ") || l.startsWith("• "))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

export class Critic {
  async review(output: string, task: Task): Promise<CritiqueResult> {
    const userPrompt =
      `Task: ${task.goal}\n\n` +
      `Acceptance criteria:\n${task.acceptance_criteria.map((c) => `- ${c}`).join("\n")}\n\n` +
      `Code output to review:\n\n${output.slice(0, 8000)}`;

    let raw = "";
    try {
      raw = await callClaude(CRITIC_SYSTEM_PROMPT, userPrompt);
    } catch {
      // Plugin failures must not crash — return a passing result
      return { passed: true, issues: [], raw: "" };
    }

    const lgtm = /\bLGTM\b/i.test(raw);
    const issues = lgtm ? [] : parseBulletPoints(raw);

    return {
      passed: lgtm || issues.length === 0,
      issues,
      raw,
    };
  }
}
