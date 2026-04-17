import type { Plan, PlanStatus, PlanTask } from "../types/plan.ts";

const DEFAULT_DETAIL_LINE_LIMIT = 3;

function readMetadataStringList(
	task: PlanTask,
	key: "detailLines" | "details" | "acceptanceCriteria",
): string[] {
	const candidate = task.metadata?.[key];
	if (!Array.isArray(candidate)) return [];

	return candidate
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function readMetadataTaskRefs(
	task: PlanTask,
	key: "dependsOnIds" | "dependsOnTaskIds" | "dependsOnTitles",
): string[] {
	const candidate = task.metadata?.[key];
	if (!Array.isArray(candidate)) return [];

	return [...new Set(
		candidate
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter((item) => item.length > 0),
	)];
}

export function flattenPlanTasks(tasks: PlanTask[]): PlanTask[] {
	const flat: PlanTask[] = [];

	for (const task of tasks) {
		flat.push(task);
		if (task.children && task.children.length > 0) {
			flat.push(...flattenPlanTasks(task.children));
		}
	}

	return flat;
}

export function collectTaskDetailLines(
	task: PlanTask,
	taskLogs?: Record<string, string[]>,
	maxLines = DEFAULT_DETAIL_LINE_LIMIT,
): string[] {
	const logLines =
		taskLogs?.[task.id]
			?.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.slice(-maxLines) ?? [];
	if (logLines.length > 0) return logLines;

	const directDetails = (task.detailLines ?? [])
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (directDetails.length > 0) return directDetails.slice(0, maxLines);

	const metadataDetails = [
		...readMetadataStringList(task, "detailLines"),
		...readMetadataStringList(task, "details"),
		...readMetadataStringList(task, "acceptanceCriteria"),
	];
	if (metadataDetails.length > 0) return metadataDetails.slice(0, maxLines);

	return [];
}

export interface PlanTaskPresentationState {
	order: number;
	dependencyIds: string[];
	blockedByIds: string[];
	blockedByOrders: number[];
	blockedByTitles: string[];
	blocked: boolean;
	active: boolean;
	activePath: boolean;
	hasInterestingDescendant: boolean;
}

export type PlanExpansionMode = "auto" | "all" | "collapsed";

export interface PlanPresentationModel {
	activeTaskId: string | null;
	taskStateById: Record<string, PlanTaskPresentationState>;
	rootSummary: {
		total: number;
		completed: number;
		running: number;
		failed: number;
		blocked: number;
		ready: number;
	};
}

export interface PlanRenderEntryParallelGroup {
	type: "parallel-group";
	taskIds: string[];
	taskOrders: number[];
	label: string;
}

export interface PlanRenderEntryTask {
	type: "task";
	task: PlanTask;
}

export type PlanRenderEntry = PlanRenderEntryParallelGroup | PlanRenderEntryTask;

export interface PlanTimelineEvent {
	tone: "info" | "success" | "warning" | "error";
	text: string;
}

function isReadyLikeStatus(status: PlanStatus): boolean {
	return status === "pending" || status === "paused";
}

export function buildPlanPresentationModel(plan: Plan): PlanPresentationModel {
	const flatTasks = flattenPlanTasks(plan.tasks);
	const orderById = new Map<string, number>();
	const taskById = new Map<string, PlanTask>();
	const taskByTitle = new Map<string, PlanTask>();

	for (const [index, task] of flatTasks.entries()) {
		const order =
			typeof task.order === "number" && Number.isFinite(task.order)
				? task.order
				: index + 1;
		orderById.set(task.id, order);
		taskById.set(task.id, task);
		if (!taskByTitle.has(task.title)) {
			taskByTitle.set(task.title, task);
		}
	}

	const taskStateById: Record<string, PlanTaskPresentationState> = {};

	for (const task of flatTasks) {
		const dependencyIds = [
			...readMetadataTaskRefs(task, "dependsOnIds"),
			...readMetadataTaskRefs(task, "dependsOnTaskIds"),
			...readMetadataTaskRefs(task, "dependsOnTitles")
				.map((title) => taskByTitle.get(title)?.id ?? null)
				.filter((id): id is string => Boolean(id)),
		].filter((depId, index, all) => all.indexOf(depId) === index);

		const blockedByIds = dependencyIds.filter((depId) => {
			const dependency = taskById.get(depId);
			return dependency ? dependency.status !== "completed" : false;
		});
		const blockedByOrders = blockedByIds
			.map((depId) => orderById.get(depId))
			.filter((order): order is number => typeof order === "number");
		const blockedByTitles = blockedByIds
			.map((depId) => taskById.get(depId)?.title ?? depId)
			.filter((title, index, all) => all.indexOf(title) === index);
		const blocked = isReadyLikeStatus(task.status) && blockedByIds.length > 0;

		taskStateById[task.id] = {
			order: orderById.get(task.id) ?? 0,
			dependencyIds,
			blockedByIds,
			blockedByOrders,
			blockedByTitles,
			blocked,
			active: false,
			activePath: false,
			hasInterestingDescendant: false,
		};
	}

	const activeTask =
		flatTasks.find(
			(task) =>
				task.status === "running" && !taskStateById[task.id]?.blocked,
		) ??
		flatTasks.find(
			(task) =>
				isReadyLikeStatus(task.status) && !taskStateById[task.id]?.blocked,
		) ??
		flatTasks.find((task) => isReadyLikeStatus(task.status)) ??
		flatTasks.at(-1) ??
		null;
	const activeTaskId = activeTask?.id ?? null;

	if (activeTaskId && taskStateById[activeTaskId]) {
		taskStateById[activeTaskId].active = true;
	}

	function annotateTask(task: PlanTask): { activePath: boolean; interesting: boolean } {
		const state = taskStateById[task.id];
		const children = task.children ?? [];
		let activePath = state?.active ?? false;
		let interesting =
			task.status === "running" ||
			task.status === "failed" ||
			task.status === "paused";

		for (const child of children) {
			const childFlags = annotateTask(child);
			activePath ||= childFlags.activePath;
			interesting ||= childFlags.interesting;
		}

		if (state) {
			state.activePath = activePath;
			state.hasInterestingDescendant = interesting && !state.active;
		}

		return { activePath, interesting };
	}

	for (const task of plan.tasks) {
		annotateTask(task);
	}

	const rootSummary = {
		total: plan.tasks.length,
		completed: 0,
		running: 0,
		failed: 0,
		blocked: 0,
		ready: 0,
	};

	for (const task of plan.tasks) {
		const state = taskStateById[task.id];
		if (state?.blocked) {
			rootSummary.blocked += 1;
			continue;
		}

		switch (task.status) {
			case "completed":
				rootSummary.completed += 1;
				break;
			case "running":
				rootSummary.running += 1;
				break;
			case "failed":
				rootSummary.failed += 1;
				break;
			case "pending":
			case "paused":
				rootSummary.ready += 1;
				break;
		}
	}

	return {
		activeTaskId,
		taskStateById,
		rootSummary,
	};
}

export function resolveTaskExpandedState(
	task: PlanTask,
	depth: number,
	taskState: PlanTaskPresentationState | undefined,
	detailLines: string[],
	defaultExpanded: boolean,
	expansionMode: PlanExpansionMode = "auto",
	manualExpanded?: boolean,
): boolean {
	const metadataExpanded = task.metadata?.expanded;
	if (typeof metadataExpanded === "boolean") {
		return metadataExpanded;
	}

	if (typeof manualExpanded === "boolean") {
		return manualExpanded;
	}

	if (expansionMode === "all") return true;
	if (expansionMode === "collapsed") return false;

	if (task.status === "running" || task.status === "failed") return true;
	if (task.status === "paused" && detailLines.length > 0) return true;
	if (taskState?.activePath) return true;
	if (depth > 0) return false;
	if (!defaultExpanded) return false;
	return detailLines.length > 0 && task.status !== "completed";
}

function canParallelize(task: PlanTask, taskState: PlanTaskPresentationState | undefined): boolean {
	if (!taskState || taskState.blocked) return false;
	return (
		task.status === "pending" ||
		task.status === "running" ||
		task.status === "paused"
	);
}

function parallelSignature(taskState: PlanTaskPresentationState | undefined): string {
	if (!taskState) return "none";
	return taskState.dependencyIds.slice().sort().join("|");
}

export function buildTopLevelRenderEntries(
	tasks: PlanTask[],
	taskStateById: Record<string, PlanTaskPresentationState>,
): PlanRenderEntry[] {
	const entries: PlanRenderEntry[] = [];

	for (let index = 0; index < tasks.length; ) {
		const current = tasks[index];
		if (!current) break;
		const currentState = taskStateById[current.id];

		if (!canParallelize(current, currentState)) {
			entries.push({ type: "task", task: current });
			index += 1;
			continue;
		}

		const signature = parallelSignature(currentState);
		const group: PlanTask[] = [current];
		let cursor = index + 1;
		while (cursor < tasks.length) {
			const candidate = tasks[cursor];
			if (!candidate) break;
			const candidateState = taskStateById[candidate.id];
			if (
				!canParallelize(candidate, candidateState) ||
				parallelSignature(candidateState) !== signature
			) {
				break;
			}
			group.push(candidate);
			cursor += 1;
		}

		if (group.length >= 2) {
			const taskOrders = group
				.map((task) => taskStateById[task.id]?.order)
				.filter((order): order is number => typeof order === "number");
			entries.push({
				type: "parallel-group",
				taskIds: group.map((task) => task.id),
				taskOrders,
				label: `Parallel lane · ${taskOrders
					.map((order) => `#${order}`)
					.join(", ")} can run together`,
			});
		}

		for (const task of group) {
			entries.push({ type: "task", task });
		}
		index = cursor;
	}

	return entries;
}

function formatTaskRefs(orders: number[]): string {
	if (orders.length === 0) return "";
	if (orders.length === 1) return `#${orders[0]}`;
	if (orders.length === 2) return `#${orders[0]} and #${orders[1]}`;
	return `${orders.slice(0, -1).map((order) => `#${order}`).join(", ")}, and #${
		orders[orders.length - 1]
	}`;
}

function isDispatchableTask(
	task: PlanTask,
	taskState: PlanTaskPresentationState | undefined,
): boolean {
	return taskState != null && !taskState.blocked && isReadyLikeStatus(task.status);
}

export function derivePlanTimelineEvents(
	previousPlan: Plan | null,
	currentPlan: Plan,
): PlanTimelineEvent[] {
	if (!previousPlan || previousPlan.id !== currentPlan.id) return [];

	const previousPresentation = buildPlanPresentationModel(previousPlan);
	const currentPresentation = buildPlanPresentationModel(currentPlan);
	const previousTasks = new Map(
		flattenPlanTasks(previousPlan.tasks).map((task) => [task.id, task]),
	);
	const currentTasks = flattenPlanTasks(currentPlan.tasks);
	const events: PlanTimelineEvent[] = [];

	for (const task of currentTasks) {
		const previousTask = previousTasks.get(task.id);
		if (!previousTask || previousTask.status === task.status) continue;
		const order = currentPresentation.taskStateById[task.id]?.order;
		const taskRef = order ? `#${order}` : task.title;

		if (task.status === "completed") {
			events.push({
				tone: "success",
				text: `${taskRef} complete`,
			});
			continue;
		}

		if (task.status === "running") {
			events.push({
				tone: "info",
				text: `Starting ${taskRef}`,
			});
			continue;
		}

		if (task.status === "failed") {
			events.push({
				tone: "error",
				text: `${taskRef} failed`,
			});
			continue;
		}

		if (task.status === "paused") {
			events.push({
				tone: "warning",
				text: `${taskRef} needs verification`,
			});
		}
	}

	const previousDispatchable = new Set(
		currentPlan.tasks
			.map((task) => {
				const previousTask = previousTasks.get(task.id);
				if (!previousTask) return null;
				const previousState = previousPresentation.taskStateById[task.id];
				return isDispatchableTask(previousTask, previousState) ? task.id : null;
			})
			.filter((taskId): taskId is string => Boolean(taskId)),
	);
	const currentTopLevelEntries = buildTopLevelRenderEntries(
		currentPlan.tasks,
		currentPresentation.taskStateById,
	);
	const newlyDispatchable = currentPlan.tasks.filter((task) => {
		const currentState = currentPresentation.taskStateById[task.id];
		return (
			isDispatchableTask(task, currentState) && !previousDispatchable.has(task.id)
		);
	});
	const newlyDispatchableIds = new Set(newlyDispatchable.map((task) => task.id));
	const parallelGroupTaskIds = new Set<string>();

	for (const entry of currentTopLevelEntries) {
		if (entry.type === "parallel-group") {
			const fresh = entry.taskIds.filter((taskId) => newlyDispatchableIds.has(taskId));
			if (fresh.length === entry.taskIds.length) {
				for (const taskId of entry.taskIds) {
					parallelGroupTaskIds.add(taskId);
				}
				events.push({
					tone: "info",
					text: `Dispatching ${formatTaskRefs(entry.taskOrders)} in parallel`,
				});
			}
			continue;
		}

		if (
			!newlyDispatchableIds.has(entry.task.id) ||
			parallelGroupTaskIds.has(entry.task.id)
		) {
			continue;
		}
		const order = currentPresentation.taskStateById[entry.task.id]?.order;
		if (!order) continue;
		events.push({
			tone: "info",
			text: `Dispatching #${order}`,
		});
	}

	return events;
}
