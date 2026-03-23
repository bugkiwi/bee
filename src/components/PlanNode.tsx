import { Box, Text } from "ink";
import type { Plan, PlanStatus, PlanTask } from "../types/plan.ts";

const DEFAULT_DETAIL_LINE_LIMIT = 3;

const STATUS_PILL_META: Record<
	PlanStatus,
	{ color: string; icon: string; label: string }
> = {
	completed: { color: "green", icon: "✓", label: "DONE" },
	failed: { color: "red", icon: "×", label: "FAILED" },
	paused: { color: "cyan", icon: "◆", label: "VERIFY" },
	pending: { color: "gray", icon: "•", label: "PENDING" },
	running: { color: "yellow", icon: "▶", label: "RUNNING" },
};

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
	return STATUS_PILL_META[status];
}

function getKindTone(kind: "plan" | "task"): { color: string; label: string } {
	return kind === "plan"
		? { color: "cyan", label: "PLAN" }
		: { color: "green", label: "TASK" };
}

function getTitleColor(kind: "plan" | "task", status: PlanStatus): string {
	if (status === "running") return kind === "plan" ? "white" : "green";
	if (status === "paused") return "cyan";
	if (status === "completed") return "gray";
	if (status === "failed") return "red";
	return kind === "plan" ? "gray" : "white";
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

function shouldExpandTask(
	task: PlanTask,
	depth: number,
	detailLines: string[],
	defaultExpanded: boolean,
): boolean {
	const metadataExpanded = task.metadata?.expanded;
	if (typeof metadataExpanded === "boolean") {
		return metadataExpanded;
	}

	if (depth > 0) return true;
	if (!defaultExpanded) return false;
	return (
		task.status === "running" ||
		task.status === "paused" ||
		task.status === "failed"
	);
}

function renderDetailColor(status: PlanStatus): string {
	switch (status) {
		case "failed":
			return "red";
		case "completed":
			return "green";
		case "running":
			return "green";
		case "paused":
			return "cyan";
		default:
			return "gray";
	}
}

function StatusPill({ status }: { status: PlanStatus }) {
	const tone = getStatusTone(status);

	return (
		<Text color={tone.color} bold>
			[ {tone.icon} {tone.label} ]
		</Text>
	);
}

function KindPill({ kind }: { kind: "plan" | "task" }) {
	const tone = getKindTone(kind);

	return (
		<Text color={tone.color} bold>
			[ {tone.label} ]
		</Text>
	);
}

interface TaskNodeProps {
	task: PlanTask;
	depth: number;
	isLast: boolean;
	ancestorHasNext: boolean[];
	defaultExpanded: boolean;
	taskLogs?: Record<string, string[]>;
}

export function TaskNode({
	task,
	depth,
	isLast,
	ancestorHasNext,
	defaultExpanded,
	taskLogs,
}: TaskNodeProps) {
	const kind = getTaskKind(task, depth);
	const children = getTaskChildren(task);
	const detailLines = collectTaskDetailLines(task, taskLogs);
	const expanded = shouldExpandTask(task, depth, detailLines, defaultExpanded);
	const hasChildren = children.length > 0;
	const marker = hasChildren ? (expanded ? "▾" : "▸") : "•";
	const titleColor = getTitleColor(kind, task.status);
	const detailColor = renderDetailColor(task.status);
	const detailPrefix = buildDetailPrefix(ancestorHasNext, isLast);

	const fallbackDescription =
		!hasChildren && detailLines.length === 0 && depth > 0 && task.description
			? [task.description]
			: [];
	const visibleDetails =
		detailLines.length > 0 ? detailLines : fallbackDescription;

	return (
		<Box flexDirection="column">
			<Box width="100%" justifyContent="space-between">
				<Box flexDirection="row" flexGrow={1}>
					<Text color="gray" dimColor>
						{buildTreePrefix(ancestorHasNext, isLast, marker)}
					</Text>
					<KindPill kind={kind} />
					<Text> </Text>
					<Text
						color={titleColor}
						bold={task.status === "running" || task.status === "paused"}
						dimColor={task.status === "completed"}
					>
						{task.title}
					</Text>
				</Box>
				<StatusPill status={task.status} />
			</Box>

			{expanded &&
				visibleDetails.map((line, index) => (
					<Box key={`${task.id}-detail-${index}`} flexDirection="row">
						<Text color="gray" dimColor>
							{detailPrefix}
						</Text>
						<Text color={detailColor}>
							{task.status === "failed" ? "×" : "✓"}
						</Text>
						<Text> </Text>
						<Text color={detailColor} dimColor={task.status !== "running"}>
							{line}
						</Text>
					</Box>
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
}

export function PlanNode({
	plan,
	taskLogs,
	defaultExpanded = true,
	terminalWidth = 80,
}: PlanNodeProps) {
	const divider = "─".repeat(Math.max(20, terminalWidth - 4));

	return (
		<Box flexDirection="column" width="100%">
			<Box width="100%" justifyContent="space-between">
				<Box flexDirection="row" flexGrow={1}>
					<Text color="cyan">◇ </Text>
					<Text color="yellow" bold>
						{plan.title}
					</Text>
				</Box>
				<StatusPill status={plan.status} />
			</Box>

			<Text color="gray" dimColor>
				{divider}
			</Text>

			{plan.tasks.length === 0 ? (
				<Text color="gray" dimColor>
					No plan nodes yet.
				</Text>
			) : (
				plan.tasks.map((task, index) => (
					<TaskNode
						key={task.id}
						task={task}
						depth={0}
						isLast={index === plan.tasks.length - 1}
						ancestorHasNext={[]}
						defaultExpanded={defaultExpanded}
						taskLogs={taskLogs}
					/>
				))
			)}
		</Box>
	);
}
