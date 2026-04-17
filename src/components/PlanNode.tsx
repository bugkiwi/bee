import { Box, Text } from "ink";
import type { Plan, PlanStatus, PlanTask } from "../types/plan.ts";
import {
	buildTopLevelRenderEntries,
	buildPlanPresentationModel,
	collectTaskDetailLines,
	type PlanExpansionMode,
	type PlanTimelineEvent,
	type PlanTaskPresentationState,
	resolveTaskExpandedState,
} from "./plan-task-helpers.ts";

function getTaskKind(task: PlanTask, depth: number): "plan" | "task" {
	return task.kind ?? (depth === 0 ? "plan" : "task");
}

function getTaskChildren(task: PlanTask): PlanTask[] {
	return task.children ?? [];
}

function getStatusTone(status: PlanStatus): {
	color: string;
	icon: string;
	label: string;
} {
	switch (status) {
		case "completed":
			return { color: "green", icon: "✓", label: "done" };
		case "failed":
			return { color: "red", icon: "×", label: "failed" };
		case "paused":
			return { color: "cyan", icon: "◆", label: "verify" };
		case "running":
			return { color: "yellow", icon: "◉", label: "active" };
		default:
			return { color: "gray", icon: "□", label: "pending" };
	}
}

function buildTreePrefix(
	ancestorHasNext: boolean[],
	isLast: boolean,
	marker: string,
): string {
	const rail = ancestorHasNext
		.map((hasNext) => (hasNext ? "│  " : "   "))
		.join("");
	const branch = isLast ? "└─ " : "├─ ";
	return `${rail}${branch}${marker} `;
}

function buildDetailPrefix(
	ancestorHasNext: boolean[],
	isLast: boolean,
): string {
	const rail = ancestorHasNext
		.map((hasNext) => (hasNext ? "│  " : "   "))
		.join("");
	return `${rail}${isLast ? "   " : "│  "}   `;
}

function renderDetailColor(status: PlanStatus): string {
	switch (status) {
		case "failed":
			return "red";
		case "completed":
			return "green";
		case "running":
			return "yellow";
		case "paused":
			return "cyan";
		default:
			return "gray";
	}
}

function renderTaskStateSummary(
	task: PlanTask,
	taskState: PlanTaskPresentationState | undefined,
): {
	color: string;
	text: string;
} | null {
	if (!taskState) return null;
	if (taskState.blocked && taskState.blockedByOrders.length > 0) {
		return {
			color: "gray",
			text: `blocked by ${taskState.blockedByOrders
				.map((order) => `#${order}`)
				.join(", ")}`,
		};
	}

	switch (task.status) {
		case "running":
			return { color: "yellow", text: "in progress" };
		case "failed":
			return { color: "red", text: "needs fix" };
		case "paused":
			return { color: "cyan", text: "needs verification" };
		case "pending":
			return { color: "white", text: "ready" };
		default:
			return null;
	}
}

function getTaskTitleColor(
	task: PlanTask,
	taskState: PlanTaskPresentationState | undefined,
): string {
	if (taskState?.blocked) return "gray";
	if (task.status === "running") return "yellow";
	if (task.status === "failed") return "red";
	if (task.status === "paused") return "cyan";
	if (task.status === "completed") return "gray";
	return "white";
}

function renderPlanSummary(
	plan: Plan,
	presentation: ReturnType<typeof buildPlanPresentationModel>,
) {
	const { rootSummary, activeTaskId, taskStateById } = presentation;
	const activeTask = activeTaskId
		? collectChildren(plan.tasks).find((task) => task.id === activeTaskId) ??
			null
		: null;
	const activeTaskState = activeTask ? taskStateById[activeTask.id] : undefined;
	const planTone = getStatusTone(plan.status);

	return (
		<Box flexDirection="column" width="100%">
			<Text>
				<Text color={planTone.color}>{planTone.icon}</Text>
				<Text> </Text>
				<Text color="yellow" bold>
					{plan.title}
				</Text>
			</Text>
			<Text color="gray" dimColor>
				{`${rootSummary.completed}/${rootSummary.total} done`}
				{rootSummary.running > 0 ? ` · ${rootSummary.running} active` : ""}
				{rootSummary.blocked > 0 ? ` · ${rootSummary.blocked} blocked` : ""}
				{rootSummary.failed > 0 ? ` · ${rootSummary.failed} failed` : ""}
				{rootSummary.ready > 0 ? ` · ${rootSummary.ready} ready` : ""}
			</Text>
			{activeTask && activeTaskState ? (
				<Text color="gray" dimColor>
					{`Current focus: #${activeTaskState.order} ${activeTask.title}`}
				</Text>
			) : null}
		</Box>
	);
}

function collectChildren(tasks: PlanTask[]): PlanTask[] {
	const output: PlanTask[] = [];
	for (const task of tasks) {
		output.push(task);
		if (task.children?.length) {
			output.push(...collectChildren(task.children));
		}
	}
	return output;
}

interface TaskNodeProps {
	task: PlanTask;
	depth: number;
	isLast: boolean;
	ancestorHasNext: boolean[];
	defaultExpanded: boolean;
	taskLogs?: Record<string, string[]>;
	taskStateById: Record<string, PlanTaskPresentationState>;
	expansionMode: PlanExpansionMode;
	taskExpansionOverrides?: Record<string, boolean>;
}

export function TaskNode({
	task,
	depth,
	isLast,
	ancestorHasNext,
	defaultExpanded,
	taskLogs,
	taskStateById,
	expansionMode,
	taskExpansionOverrides,
}: TaskNodeProps) {
	const taskState = taskStateById[task.id];
	const kind = getTaskKind(task, depth);
	const children = getTaskChildren(task);
	const detailLines = collectTaskDetailLines(
		task,
		taskLogs,
		taskState?.active ? 5 : 3,
	);
	const expanded = resolveTaskExpandedState(
		task,
		depth,
		taskState,
		detailLines,
		defaultExpanded,
		expansionMode,
		taskExpansionOverrides?.[task.id],
	);
	const hasChildren = children.length > 0;
	const titleColor = getTaskTitleColor(task, taskState);
	const detailColor = renderDetailColor(task.status);
	const detailPrefix = buildDetailPrefix(ancestorHasNext, isLast);
	const statusTone =
		taskState?.blocked === true
			? { color: "gray", icon: "□", label: "blocked" }
			: getStatusTone(task.status);
	const marker = hasChildren && expanded ? "▾" : hasChildren ? "▸" : "•";
	const taskLabel = taskState ? `#${taskState.order}` : kind === "plan" ? "plan" : "task";
	const secondary = renderTaskStateSummary(task, taskState);

	const fallbackDescription =
		detailLines.length === 0 && (task.status === "running" || task.status === "failed")
			? [task.description]
			: [];
	const visibleDetails = detailLines.length > 0 ? detailLines : fallbackDescription;

	return (
		<Box flexDirection="column">
			<Text>
				<Text color="gray" dimColor>
					{buildTreePrefix(ancestorHasNext, isLast, marker)}
				</Text>
				<Text color={statusTone.color}>{statusTone.icon}</Text>
				<Text> </Text>
				<Text color="gray" dimColor>
					{`${taskLabel} `}
				</Text>
				<Text
					color={titleColor}
					bold={taskState?.active || task.status === "running"}
					dimColor={task.status === "completed"}
				>
					{task.title}
				</Text>
				{secondary ? (
					<>
						<Text color="gray" dimColor>
							{"  › "}
						</Text>
						<Text color={secondary.color} dimColor={!taskState?.active}>
							{secondary.text}
						</Text>
					</>
				) : null}
			</Text>

			{expanded &&
				visibleDetails.map((line, index) => (
					<Text key={`${task.id}-detail-${index}`}>
						<Text color="gray" dimColor>
							{detailPrefix}
						</Text>
						<Text color={detailColor}>
							{task.status === "failed" ? "×" : "↳"}
						</Text>
						<Text> </Text>
						<Text color={detailColor} dimColor={task.status !== "running"}>
							{line}
						</Text>
					</Text>
				))}

			{expanded &&
				children.map((child, index) => (
					<TaskNode
						key={child.id}
						task={child}
						depth={depth + 1}
						isLast={index === children.length - 1}
						ancestorHasNext={[...ancestorHasNext, !isLast]}
						defaultExpanded={defaultExpanded}
						taskLogs={taskLogs}
						taskStateById={taskStateById}
						expansionMode={expansionMode}
						taskExpansionOverrides={taskExpansionOverrides}
					/>
				))}
		</Box>
	);
}

interface PlanNodeProps {
	plan: Plan;
	taskLogs?: Record<string, string[]>;
	defaultExpanded?: boolean;
	terminalWidth?: number;
	expansionMode?: PlanExpansionMode;
	taskExpansionOverrides?: Record<string, boolean>;
	timelineEvents?: PlanTimelineEvent[];
}

export function PlanNode({
	plan,
	taskLogs,
	defaultExpanded = true,
	expansionMode = "auto",
	taskExpansionOverrides,
	timelineEvents = [],
}: PlanNodeProps) {
	const presentation = buildPlanPresentationModel(plan);
	const renderEntries = buildTopLevelRenderEntries(
		plan.tasks,
		presentation.taskStateById,
	);
	const taskEntryIds = renderEntries
		.filter(
			(entry): entry is Extract<(typeof renderEntries)[number], { type: "task" }> =>
				entry.type === "task",
		)
		.map((entry) => entry.task.id);

	return (
		<Box flexDirection="column" width="100%">
			{renderPlanSummary(plan, presentation)}
			<Text color="gray" dimColor>
				Ctrl+O toggle focus · Ctrl+Shift+O toggle all
			</Text>

			{timelineEvents.length > 0 ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="gray" dimColor>
						Execution Flow
					</Text>
					{timelineEvents.map((event, index) => (
						<Text
							key={`timeline-${index}-${event.text}`}
							color={
								event.tone === "success"
									? "green"
									: event.tone === "error"
										? "red"
										: event.tone === "warning"
											? "cyan"
											: "yellow"
							}
							dimColor={event.tone === "info"}
						>
							{event.tone === "success"
								? "✓ "
								: event.tone === "error"
									? "× "
									: event.tone === "warning"
										? "◆ "
										: "→ "}
							{event.text}
						</Text>
					))}
				</Box>
			) : null}

			<Box marginTop={1} flexDirection="column">
				<Text color="gray" dimColor>
					Task List
				</Text>
				{plan.tasks.length === 0 ? (
					<Text color="gray" dimColor>
						Waiting for planner nodes or live task hydration.
					</Text>
				) : (
					renderEntries.map((entry, index) =>
						entry.type === "parallel-group" ? (
							<Text
								key={`parallel-group-${entry.taskIds.join("-")}`}
								color="cyan"
								dimColor
							>
								{entry.label}
							</Text>
						) : (
							<TaskNode
								key={entry.task.id}
								task={entry.task}
								depth={0}
								isLast={
									entry.task.id === taskEntryIds[taskEntryIds.length - 1]
								}
								ancestorHasNext={[]}
								defaultExpanded={defaultExpanded}
								taskLogs={taskLogs}
								taskStateById={presentation.taskStateById}
								expansionMode={expansionMode}
								taskExpansionOverrides={taskExpansionOverrides}
							/>
						),
					)
				)}
			</Box>
		</Box>
	);
}
