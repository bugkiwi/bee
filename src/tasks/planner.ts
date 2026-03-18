import type { Task } from "../types/task.ts";
import { TaskSchema } from "../schema/task.schema.ts";
import { generateTaskId } from "../utils/id.ts";

const PLANNER_SYSTEM_PROMPT = `You are a task planner for a deterministic coding agent.
Given a specification, output a SINGLE valid JSON object matching the Task schema exactly.
Output ONLY the JSON object — no markdown, no explanation, no code fences.

Task schema:
{
  "task_id": "string (use the provided id)",
  "goal": "string (clear, specific goal)",
  "steps": [{ "id": number, "desc": "string", "status": "pending" }],
  "acceptance_criteria": ["string"],
  "tests_required": boolean,
  "status": "pending",
  "provider": "claude" | "codex",
  "priority": number,
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}`;

export class Planner {
  async fromSpec(
    specContent: string,
    opts: { taskId?: string; provider?: string } = {}
  ): Promise<Task> {
    const taskId = opts.taskId ?? generateTaskId();
    const now = new Date().toISOString();

    const prompt = `Task ID: ${taskId}
Provider: ${opts.provider ?? "claude"}
Created at: ${now}

Specification:
${specContent}

Output the Task JSON now:`;

    // Use Claude subprocess directly to generate plan
    const proc = Bun.spawn(
      [
        "claude",
        "--print",
        "--output-format",
        "json",
        "--system-prompt",
        PLANNER_SYSTEM_PROMPT,
        prompt,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Planner failed: ${await new Response(proc.stderr).text()}`);
    }

    // Try to parse JSON from the output
    const json = extractJson(stdout);
    const parsed = TaskSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Invalid task JSON from planner: ${parsed.error.message}\n\nRaw: ${stdout.slice(0, 500)}`);
    }

    return parsed.data as Task;
  }

  fromRaw(raw: unknown): Task {
    const parsed = TaskSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid task: ${parsed.error.message}`);
    }
    return parsed.data as Task;
  }
}

function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {}
  // Find first { ... } block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new Error("No valid JSON found in planner output");
}
