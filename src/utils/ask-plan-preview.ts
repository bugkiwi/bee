import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { AskPlanSchema } from "../schema/ask-plan.schema.ts";
import { TaskSchema } from "../schema/task.schema.ts";
import type {
	AskPlan,
	AskPlanNode,
	AskPlanNodeStatus,
	AskPlanStatus,
} from "../types/ask-plan.ts";
import { type Plan, PlanStatus, type PlanTask } from "../types/plan.ts";
import type { AgentTask, AgentTaskStatus } from "../types/task.ts";
import type { PlanPreviewMeta } from "../types/transcript.ts";
import { listFiles, readJsonFile } from "./fs.ts";

export interface AskPlanPreviewLine {
	type: "assistant";
	text: string;
	meta: PlanPreviewMeta;
}

function toPlanStatus(status: AskPlanStatus | AskPlanNodeStatus) {
	switch (status) {
		case "done":
			return PlanStatus.completed;
		case "planning":
		case "running":
			return PlanStatus.running;
		case "failed":
			return PlanStatus.failed;
		default:
			return PlanStatus.pending;
	}
}

function toTaskPlanStatus(status: AgentTaskStatus) {
	switch (status) {
		case "done":
			return PlanStatus.completed;
		case "running":
		case "retrying":
		case "verifying":
			return PlanStatus.running;
		case "failed":
			return PlanStatus.failed;
		default:
			return PlanStatus.pending;
	}
}

function taskToPlanTask(task: AgentTask): PlanTask {
	const nextStep = task.steps.find((step) => step.status !== "done");

	return {
		id: task.task_id,
		title: task.goal,
		description: task.goal,
		status: toTaskPlanStatus(task.status),
		kind: "task",
		detailLines: [
			`Task ${task.task_id}`,
			...(nextStep ? [`Next: ${nextStep.desc}`] : []),
		].slice(0, 2),
		createdAt: task.created_at,
		updatedAt: task.updated_at,
		metadata: {
			expanded: true,
			acceptanceCriteria: task.acceptance_criteria,
			testsRequired: task.tests_required,
		},
	};
}

function missingTaskToPlanTask(
	taskId: string,
	createdAt: string,
	updatedAt: string,
): PlanTask {
	return {
		id: `missing-${taskId}`,
		title: taskId,
		description: taskId,
		status: PlanStatus.failed,
		kind: "task",
		detailLines: [`Missing task file for ${taskId}`],
		createdAt,
		updatedAt,
		metadata: {
			expanded: true,
			missing: true,
		},
	};
}

async function loadLinkedTasks(
	taskIds: string[] | undefined,
	tasksDir: string | undefined,
	createdAt: string,
	updatedAt: string,
): Promise<PlanTask[]> {
	if (!taskIds || taskIds.length === 0) return [];

	if (!tasksDir) {
		return taskIds.map((taskId) => ({
			id: taskId,
			title: taskId,
			description: taskId,
			status: PlanStatus.pending,
			kind: "task",
			detailLines: [`Linked task ${taskId}`],
			createdAt,
			updatedAt,
			metadata: { expanded: true },
		}));
	}

	const linkedTasks = await Promise.all(
		taskIds.map(async (taskId) => {
			try {
				const raw = await readJsonFile(join(tasksDir, `${taskId}.json`));
				const parsed = TaskSchema.safeParse(raw);
				if (!parsed.success) {
					return missingTaskToPlanTask(taskId, createdAt, updatedAt);
				}
				return taskToPlanTask(parsed.data as AgentTask);
			} catch {
				return missingTaskToPlanTask(taskId, createdAt, updatedAt);
			}
		}),
	);

	return linkedTasks;
}

async function buildLinkedTaskIndex(
	nodes: AskPlanNode[],
	tasksDir: string | undefined,
	createdAt: string,
	updatedAt: string,
	index: Record<string, PlanTask[]> = {},
): Promise<Record<string, PlanTask[]>> {
	for (const node of nodes) {
		index[node.id] = await loadLinkedTasks(
			node.leaf_task_ids,
			tasksDir,
			createdAt,
			updatedAt,
		);
		if (node.sub_nodes && node.sub_nodes.length > 0) {
			await buildLinkedTaskIndex(
				node.sub_nodes,
				tasksDir,
				createdAt,
				updatedAt,
				index,
			);
		}
	}

	return index;
}

function toPlanTask(
	node: AskPlanNode,
	createdAt: string,
	updatedAt: string,
	linkedTaskIndex: Record<string, PlanTask[]>,
): PlanTask {
	const branchChildren =
		node.sub_nodes?.map((child) =>
			toPlanTask(child, createdAt, updatedAt, linkedTaskIndex),
		) ?? [];
	const linkedTaskChildren = linkedTaskIndex[node.id] ?? [];
	const children = [...branchChildren, ...linkedTaskChildren];

	return {
		id: node.id,
		title: node.title,
		description: node.description,
		status: toPlanStatus(node.status),
		kind: children.length > 0 ? "plan" : "task",
		children,
		detailLines: [node.description],
		createdAt,
		updatedAt,
		metadata: {
			expanded: true,
			acceptanceCriteria: node.acceptance_criteria,
			leafTaskIds: node.leaf_task_ids,
			linkedTaskCount: linkedTaskChildren.length,
		},
	};
}

export function askPlanToDisplayPlan(
	plan: AskPlan,
	linkedTaskIndex: Record<string, PlanTask[]> = {},
): Plan {
	return {
		id: plan.id,
		title: plan.goal,
		description: plan.goal,
		status: toPlanStatus(plan.status),
		createdAt: plan.created_at,
		updatedAt: plan.updated_at,
		tasks: plan.root_nodes.map((node) =>
			toPlanTask(node, plan.created_at, plan.updated_at, linkedTaskIndex),
		),
		metadata: {
			source: "ask-plan",
		},
	};
}

export async function hydrateAskPlanToDisplayPlan(
	plan: AskPlan,
	options: {
		tasksDir?: string;
	} = {},
): Promise<Plan> {
	const linkedTaskIndex = await buildLinkedTaskIndex(
		plan.root_nodes,
		options.tasksDir,
		plan.created_at,
		plan.updated_at,
	);

	return askPlanToDisplayPlan(plan, linkedTaskIndex);
}

export function createAskPlanPreviewMeta(
	plan: AskPlan,
	sourcePath: string,
	linkedTaskIndex: Record<string, PlanTask[]> = {},
): PlanPreviewMeta {
	return {
		kind: "plan-preview",
		sourcePath,
		plan: askPlanToDisplayPlan(plan, linkedTaskIndex),
	};
}

export async function loadAskPlanPreviewMeta(
	sourcePath: string,
	options: {
		tasksDir?: string;
	} = {},
): Promise<PlanPreviewMeta | null> {
	try {
		const raw = await readJsonFile(sourcePath);
		const parsed = AskPlanSchema.safeParse(raw);
		if (!parsed.success) return null;
		return {
			kind: "plan-preview",
			sourcePath,
			plan: await hydrateAskPlanToDisplayPlan(parsed.data, options),
		};
	} catch {
		return null;
	}
}

async function latestAskPlanPath(plansDir: string): Promise<string | null> {
	const files = (await listFiles(plansDir, ".json")).filter((file) =>
		/\/ask-[^/]+\.json$/.test(file),
	);
	if (files.length === 0) return null;

	const withStats = await Promise.all(
		files.map(async (file) => {
			try {
				return { file, mtimeMs: (await stat(file)).mtimeMs };
			} catch {
				return { file, mtimeMs: 0 };
			}
		}),
	);

	withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return withStats[0]?.file ?? null;
}

function normalizeAskPlanSpecifier(specifier: string): string {
	return specifier.trim().replace(/^ask-/, "").replace(/\.json$/, "");
}

export async function resolveAskPlanPath(
	plansDir: string,
	specifier?: string,
): Promise<string | null> {
	if (!specifier || specifier.trim().length === 0) {
		return latestAskPlanPath(plansDir);
	}

	const trimmed = specifier.trim();
	const normalized = normalizeAskPlanSpecifier(trimmed);
	const candidates = [
		isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed),
		join(plansDir, trimmed),
		join(plansDir, `${trimmed}.json`),
		join(plansDir, `ask-${normalized}.json`),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

function toPreviewDisplayPath(sourcePath: string): string {
	const rel = relative(process.cwd(), sourcePath);
	if (!rel || rel.startsWith("..")) return sourcePath;
	return rel;
}

export async function loadAskPlanPreviewLine(
	specifier: string | undefined,
	dirs: {
		plansDir: string;
		tasksDir: string;
	},
): Promise<AskPlanPreviewLine | null> {
	const sourcePath = await resolveAskPlanPath(dirs.plansDir, specifier);
	if (!sourcePath) return null;

	const meta = await loadAskPlanPreviewMeta(sourcePath, {
		tasksDir: dirs.tasksDir,
	});
	if (!meta) return null;

	return {
		type: "assistant",
		text: `Plan preview · ${toPreviewDisplayPath(sourcePath)}`,
		meta,
	};
}
