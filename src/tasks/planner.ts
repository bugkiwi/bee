import { z } from "zod";
import { parseCodexStream } from "../providers/codex/parser.ts";
import { SkeletonSpecArraySchema } from "../schema/skeleton.schema.ts";
import { TaskSchema } from "../schema/task.schema.ts";
import type { AskPlan, AskPlanNode } from "../types/ask-plan.ts";
import { normalizeProviderName } from "../types/config.ts";
import type { PlanSkeleton } from "../types/skeleton.ts";
import type { AgentTask as Task } from "../types/task.ts";
import { generateId, generateTaskId } from "../utils/id.ts";
import { readLines } from "../utils/stream.ts";
import { stripAnsi } from "../utils/strip-ansi.ts";

// ── Error types ────────────────────────────────────────────────────────────────

export class EmptySkeletonError extends Error {
	constructor() {
		super("Plan returned 0 nodes");
		this.name = "EmptySkeletonError";
	}
}

export class ZodValidationError extends Error {
	constructor(fields: string) {
		super(`Plan had wrong format: ${fields}`);
		this.name = "ZodValidationError";
	}
}

export class JSONParseError extends Error {
	constructor(raw: string) {
		super(`Invalid plan output: ${raw.slice(0, 200)}`);
		this.name = "JSONParseError";
	}
}

// ── System prompts ─────────────────────────────────────────────────────────────

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

const SKELETON_SYSTEM_PROMPT = `You are a project planner for a coding agent orchestration system.
Given a high-level goal, output a JSON array of 3-7 skeleton nodes representing the major phases of work.
Output ONLY the JSON array — no markdown, no explanation, no code fences.

Each node must match this schema exactly:
{
  "title": "string (short phase name, e.g. 'Database schema')",
  "description": "string (1-2 sentences describing what this phase accomplishes)",
  "acceptance_criteria": ["string (verifiable exit condition, e.g. 'bun test passes')"],
  "depends_on": ["node-title"] (optional, only if this phase must come after another),
  "provider": "claude" | "codex" (optional, defaults to claude)
}

Rules:
- 3-7 nodes total, ordered by execution sequence
- Each acceptance_criteria item must be a shell-verifiable condition or clear observable outcome
- Phases should be roughly equal in scope
- No circular depends_on references`;

const LEAF_TASK_SYSTEM_PROMPT = `You are a task planner for a deterministic coding agent.
Given a skeleton node description and handoff context, output a JSON array of 1-10 leaf tasks.
Output ONLY the JSON array — no markdown, no explanation, no code fences.

Each task must match this schema exactly:
{
  "task_id": "string (use the provided id)",
  "goal": "string (clear, specific, actionable goal)",
  "steps": [{ "id": number, "desc": "string", "status": "pending" }],
  "acceptance_criteria": ["string"],
  "tests_required": boolean,
  "status": "pending",
  "provider": "claude",
  "priority": number,
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}`;

const HANDOFF_SYSTEM_PROMPT = `You are a context summarizer for a coding agent.
Given the completed work description, write a single paragraph (3-5 sentences) summarizing what was accomplished,
what the current state of the codebase is, and what the next phase needs to know.
Output ONLY the plain text paragraph — no markdown, no headers, no lists.`;

const DECOMPOSE_CHECK_SYSTEM_PROMPT = `You are a project planner assessing whether a work phase is complex enough to be split into sub-phases.
Output a SINGLE valid JSON object — no markdown, no explanation, no code fences.

Schema: { "decompose": boolean, "reason": "string (one sentence)" }

Decompose if the phase:
- Involves 3+ distinct technical concerns (e.g. schema + API + UI)
- Spans multiple layers of the stack
- Would clearly produce 2-5 natural sub-phases of roughly equal scope

Do NOT decompose if:
- The phase is already narrowly scoped
- It maps naturally to 1-3 leaf tasks
- Splitting would create artificial boundaries`;

const SUB_NODE_SYSTEM_PROMPT = `You are a project planner for a coding agent orchestration system.
Given a high-level phase description, output a JSON array of 2-5 sub-phases that together complete this phase.
Output ONLY the JSON array — no markdown, no explanation, no code fences.

Each sub-phase must match this schema exactly:
{
  "title": "string (short sub-phase name)",
  "description": "string (1-2 sentences describing what this sub-phase accomplishes)",
  "acceptance_criteria": ["string (verifiable exit condition)"],
  "depends_on": ["earlier sub-phase title"] (optional, only if blocked by another sub-phase)
}

Rules:
- 2-5 sub-phases total, ordered by execution sequence
- Sub-phases must be concrete and roughly equal in scope
- Together they must fully cover the parent phase
- Only depend on earlier sub-phases in the same array
- Omit depends_on when a sub-phase is independent`;

// ── Planner ────────────────────────────────────────────────────────────────────

export class Planner {
	async fromSpec(
		specContent: string,
		opts: { taskId?: string; provider?: string } = {},
	): Promise<Task> {
		const taskId = opts.taskId ?? generateTaskId();
		const now = new Date().toISOString();

		const prompt = `Task ID: ${taskId}
Provider: ${opts.provider ?? "claude"}
Created at: ${now}

Specification:
${specContent}

Output the Task JSON now:`;

		const raw = await this.callClaude(
			PLANNER_SYSTEM_PROMPT,
			prompt,
			opts.provider,
		);
		const json = extractJson(raw);
		const parsed = TaskSchema.safeParse(json);
		if (!parsed.success) {
			throw new Error(
				`Invalid task JSON from planner: ${parsed.error.message}\n\nRaw: ${raw.slice(0, 500)}`,
			);
		}

		return parsed.data as Task;
	}

	async fromSkeletonSpec(
		goal: string,
		provider?: string,
	): Promise<PlanSkeleton> {
		const now = new Date().toISOString();
		const prompt = `Goal: ${goal}
Provider preference: ${provider ?? "claude"}
Current time: ${now}

Generate the skeleton plan array now:`;

		const raw = await this.callClaude(SKELETON_SYSTEM_PROMPT, prompt, provider);
		const json = extractJsonArray(raw);
		const parsed = SkeletonSpecArraySchema.safeParse(json);

		if (!parsed.success) {
			const issues = parsed.error.issues;
			// Check for empty array specifically
			if (Array.isArray(json) && (json as unknown[]).length === 0) {
				throw new EmptySkeletonError();
			}
			throw new ZodValidationError(
				issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
			);
		}

		const skeletonId = generateId("skeleton");
		const nodes = parsed.data.map((spec, idx) => ({
			id: generateId("node"),
			title: spec.title,
			description: spec.description,
			acceptance_criteria: spec.acceptance_criteria,
			depends_on: spec.depends_on,
			provider: spec.provider ?? provider ?? "claude",
			status: "pending" as const,
			_order: idx,
		}));

		return {
			id: skeletonId,
			goal,
			created_at: now,
			nodes,
		};
	}

	async generateLeafTasks(
		node: { title: string; description: string; acceptance_criteria: string[] },
		handoffContext: string,
		provider?: string,
	): Promise<Task[]> {
		const now = new Date().toISOString();
		const prompt = `Node: ${node.title}
Description: ${node.description}
Acceptance criteria: ${node.acceptance_criteria.join("; ")}
${handoffContext ? `\nContext from previous phases:\n${handoffContext}` : ""}
Provider: ${provider ?? "claude"}
Current time: ${now}

Generate leaf tasks array now (max 10):`;

		const raw = await this.callClaude(
			LEAF_TASK_SYSTEM_PROMPT,
			prompt,
			provider,
		);
		const json = extractJsonArray(raw);

		if (!Array.isArray(json)) {
			throw new JSONParseError(raw);
		}

		const tasks: Task[] = [];
		for (const item of json as unknown[]) {
			const withId = {
				...((item as object) ?? {}),
				task_id: generateTaskId(),
				status: "pending",
				created_at: now,
				updated_at: now,
			};
			const parsed = TaskSchema.safeParse(withId);
			if (parsed.success) {
				tasks.push(parsed.data as Task);
			}
		}

		if (tasks.length === 0) {
			throw new Error(`No valid leaf tasks generated for node: ${node.title}`);
		}

		return tasks.slice(0, 10);
	}

	async generateHandoffSummary(
		nodeTitle: string,
		completedWork: string,
		provider?: string,
	): Promise<string> {
		const prompt = `Completed phase: ${nodeTitle}

What was accomplished:
${completedWork}

Write the handoff summary paragraph now:`;

		const summary = await this.callClaude(
			HANDOFF_SYSTEM_PROMPT,
			prompt,
			provider,
		);
		return summary.trim();
	}

	// ── Ask plan (recursive decomposition) ──────────────────────────────────────

	/**
	 * Build a full recursive Ask plan for a high-level goal.
	 *
	 * Phase 1 — decomposition:
	 *   1. Generate root skeleton nodes (3-7)
	 *   2. For each root node: ask if it should decompose further (depth < MAX_DEPTH)
	 *   3. If yes: generate sub-nodes
	 *   4. Leaf tasks are generated at execution time (via generateLeafTasks)
	 */
	async buildAskPlan(goal: string, provider?: string): Promise<AskPlan> {
		const MAX_DEPTH = 1; // root (0) → optional sub-nodes (1) → leaf tasks at runtime
		const now = new Date().toISOString();
		const plannerProvider = normalizeProviderName(provider ?? "claude");
		const allowRecursiveDecomposition = plannerProvider === "claude";

		// 1. Generate root-level skeleton
		const skeleton = await this.fromSkeletonSpec(goal, provider);

		// 2. Convert skeleton nodes to AskPlanNodes, decomposing where appropriate
		const rootNodes: AskPlanNode[] = [];
		for (const skNode of skeleton.nodes) {
			const node: AskPlanNode = {
				id: skNode.id,
				title: skNode.title,
				description: skNode.description,
				acceptance_criteria: skNode.acceptance_criteria,
				depends_on: skNode.depends_on,
				depth: 0,
				status: "pending",
			};

			// Check if this node warrants sub-decomposition
			if (
				allowRecursiveDecomposition &&
				(await this.shouldDecompose(node, provider))
			) {
				node.status = "planning";
				node.sub_nodes = await this.decomposeNode(node, MAX_DEPTH, provider);
				node.status = "pending";
			}

			rootNodes.push(node);
		}

		return {
			id: skeleton.id,
			goal,
			created_at: now,
			updated_at: now,
			status: "ready",
			root_nodes: rootNodes,
		};
	}

	/**
	 * Ask the LLM whether a given node is complex enough to warrant sub-decomposition.
	 * Returns false for leaf-level nodes (depth >= MAX_DEPTH).
	 */
	async shouldDecompose(
		node: Pick<AskPlanNode, "title" | "description" | "acceptance_criteria">,
		provider?: string,
	): Promise<boolean> {
		const prompt = `Phase: ${node.title}
Description: ${node.description}
Acceptance criteria: ${node.acceptance_criteria.join("; ")}
Provider: ${provider ?? "claude"}

Should this phase be split into sub-phases?`;

		try {
			const raw = await this.callClaude(
				DECOMPOSE_CHECK_SYSTEM_PROMPT,
				prompt,
				provider,
			);
			const json = extractJson(raw) as { decompose?: boolean } | null;
			return (
				typeof json === "object" && json !== null && json.decompose === true
			);
		} catch {
			return false; // on any error, default to no decomposition
		}
	}

	/**
	 * Decompose a node into 2-5 sub-nodes at the given depth.
	 */
	async decomposeNode(
		parent: Pick<AskPlanNode, "title" | "description" | "acceptance_criteria">,
		depth: number,
		provider?: string,
	): Promise<AskPlanNode[]> {
		const prompt = `Parent phase: ${parent.title}
Description: ${parent.description}
Acceptance criteria: ${parent.acceptance_criteria.join("; ")}
Provider: ${provider ?? "claude"}

Generate the sub-phases array now:`;

		const SubNodeSpecSchema = z
			.array(
				z.object({
					title: z.string(),
					description: z.string(),
					acceptance_criteria: z.array(z.string()),
					depends_on: z.array(z.string()).optional(),
				}),
			)
			.min(2)
			.max(5);

		const raw = await this.callClaude(SUB_NODE_SYSTEM_PROMPT, prompt, provider);
		const json = extractJsonArray(raw);
		const parsed = SubNodeSpecSchema.safeParse(json);

		if (!parsed.success) {
			throw new Error(`Sub-node decomposition failed: ${parsed.error.message}`);
		}

		return parsed.data.map((spec) => ({
			id: generateId("node"),
			title: spec.title,
			description: spec.description,
			acceptance_criteria: spec.acceptance_criteria,
			depends_on: spec.depends_on,
			depth,
			status: "pending" as const,
		}));
	}

	estimateCost(nodeCount: number): string {
		// Rough heuristic: ~$0.10-0.15 per node for planning + ~$0.15-0.25 per node for execution
		const low = (nodeCount * 0.25).toFixed(2);
		const high = (nodeCount * 0.4).toFixed(2);
		return `~$${low}-${high} (±50%, actual depends on task complexity)`;
	}

	fromRaw(raw: unknown): Task {
		const parsed = TaskSchema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(`Invalid task: ${parsed.error.message}`);
		}
		return parsed.data as Task;
	}

	// ── Private ──────────────────────────────────────────────────────────────────

	private async callClaude(
		systemPrompt: string,
		userPrompt: string,
		provider = "claude",
	): Promise<string> {
		const plannerProvider = normalizeProviderName(provider);

		switch (plannerProvider) {
			case "claude":
				return this.callClaudeCli(systemPrompt, userPrompt);
			case "codex":
				return this.callCodexCli(systemPrompt, userPrompt);
			case "kimi":
				return this.callKimiCli(systemPrompt, userPrompt);
			default:
				throw new Error(
					`Unsupported planner provider: "${provider}". Available: claude, codex, kimi`,
				);
		}
	}

	private async callClaudeCli(
		systemPrompt: string,
		userPrompt: string,
	): Promise<string> {
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
			{ stdout: "pipe", stderr: "pipe" },
		);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new Error(`Planner failed (claude): ${formatPlannerError(stderr)}`);
		}

		return unwrapCliText(stdout);
	}

	private async callCodexCli(
		systemPrompt: string,
		userPrompt: string,
	): Promise<string> {
		const proc = Bun.spawn(
			[
				"codex",
				"exec",
				"--json",
				"--dangerously-bypass-approvals-and-sandbox",
				this.composeInstructionPrompt(systemPrompt, userPrompt),
			],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);

		const lines = await readLines(proc.stdout);
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		const result = parseCodexStream(lines);

		if (exitCode !== 0 || !result.success) {
			throw new Error(
				`Planner failed (codex): ${result.error ?? formatPlannerError(stderr)}`,
			);
		}

		const output = unwrapCliText(result.output ?? "");
		if (!output) {
			throw new Error("Planner failed (codex): no output returned");
		}

		return output;
	}

	private async callKimiCli(
		systemPrompt: string,
		userPrompt: string,
	): Promise<string> {
		const proc = Bun.spawn(
			[
				"kimi",
				"--print",
				"--output-format",
				"text",
				"--final-message-only",
				"--prompt",
				this.composeInstructionPrompt(systemPrompt, userPrompt),
			],
			{ stdout: "pipe", stderr: "pipe" },
		);

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new Error(`Planner failed (kimi): ${formatPlannerError(stderr)}`);
		}

		const output = unwrapCliText(stdout);
		if (!output) {
			throw new Error("Planner failed (kimi): no output returned");
		}

		return output;
	}

	private composeInstructionPrompt(
		systemPrompt: string,
		userPrompt: string,
	): string {
		return [
			"SYSTEM INSTRUCTIONS:",
			systemPrompt.trim(),
			"",
			"USER REQUEST:",
			userPrompt.trim(),
		].join("\n");
	}

	/** Generic LLM call with Zod validation — used for typed outputs */
	async callLLM<T>(
		systemPrompt: string,
		userPrompt: string,
		schema: z.ZodSchema<T>,
	): Promise<T> {
		const raw = await this.callClaude(systemPrompt, userPrompt);
		let json: unknown;
		try {
			json = extractJson(raw);
		} catch {
			throw new JSONParseError(raw);
		}
		const parsed = schema.safeParse(json);
		if (!parsed.success) {
			const issues = parsed.error.issues;
			throw new ZodValidationError(
				issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
			);
		}
		return parsed.data;
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function extractJson(text: string): unknown {
	try {
		return JSON.parse(text.trim());
	} catch {}
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end !== -1 && end > start) {
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {}
	}
	// Also try array
	return extractJsonArray(text);
}

function extractJsonArray(text: string): unknown {
	try {
		const t = text.trim();
		if (t.startsWith("[")) return JSON.parse(t);
	} catch {}
	// Try to find claude --output-format json wrapper and extract the "result" field
	try {
		const wrapper = JSON.parse(text.trim()) as { result?: unknown };
		if (wrapper && typeof wrapper === "object" && "result" in wrapper) {
			const result = wrapper.result;
			if (typeof result === "string") {
				try {
					return JSON.parse(result);
				} catch {}
				const start = result.indexOf("[");
				const end = result.lastIndexOf("]");
				if (start !== -1 && end !== -1 && end > start) {
					return JSON.parse(result.slice(start, end + 1));
				}
			}
			return result;
		}
	} catch {}
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start !== -1 && end !== -1 && end > start) {
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {}
	}
	throw new JSONParseError(text);
}

function unwrapCliText(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";

	try {
		const parsed = JSON.parse(trimmed) as { result?: unknown };
		if (parsed && typeof parsed === "object" && "result" in parsed) {
			const result = parsed.result;
			return typeof result === "string" ? result : JSON.stringify(result);
		}
	} catch {}

	return trimmed;
}

function formatPlannerError(raw: string): string {
	const lines = stripAnsi(raw)
		.replaceAll("\r", "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		return "unknown error";
	}

	if (lines.length >= 3 && lines.every((line) => line.length === 1)) {
		return lines.join("");
	}

	return lines.join("\n");
}
