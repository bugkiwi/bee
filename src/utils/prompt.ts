import type { Task } from "../types/task.ts";
import type { ContextFile } from "../plugins/context-selector.ts";
import { formatContextForPrompt } from "../plugins/context-selector.ts";

export function buildPromptWithContext(task: Task, contextFiles: ContextFile[]): string {
  const base = buildPrompt(task);
  const contextSection = formatContextForPrompt(contextFiles);
  if (!contextSection) return base;
  return `${base}\n\n${contextSection}`;
}

export function buildPrompt(task: Task): string {
  const steps = task.steps
    .map((s) => `  ${s.id}. ${s.desc}`)
    .join("\n");

  const criteria = task.acceptance_criteria
    .map((c) => `  - ${c}`)
    .join("\n");

  return `# Task: ${task.task_id}

## Goal
${task.goal}

## Steps (execute ALL — no skipping)
${steps}

## Acceptance Criteria
${criteria}

## Rules
- Execute EVERY step completely
- Do NOT stop early
- Do NOT ask for confirmation
- Do NOT summarize — just do the work
- Tests ${task.tests_required ? "MUST" : "should"} pass before you finish
- Working directory: ${task.working_dir ?? process.cwd()}

Complete all steps now.`;
}
