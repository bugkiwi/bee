import { Box, Text } from "ink";
import { type Task, TaskStatus } from "../types/task.ts";
import { ProgressBar } from "./ProgressBar.tsx";

// ─── StatusBadge helpers ───────────────────────────────────────────────────────

export function statusBadge(status: TaskStatus): string {
	switch (status) {
		case TaskStatus.completed:
			return "✅";
		case TaskStatus.running:
			return "▶";
		case TaskStatus.failed:
			return "✗";
		case TaskStatus.skipped:
			return "⊘";
		default:
			return "○";
	}
}

export function statusColor(status: TaskStatus): string {
	switch (status) {
		case TaskStatus.completed:
			return "green";
		case TaskStatus.running:
			return "cyan";
		case TaskStatus.failed:
			return "red";
		case TaskStatus.skipped:
			return "yellow";
		default:
			return "gray";
	}
}

// ─── Step progress helpers ─────────────────────────────────────────────────────

export function stepProgress(task: Task): string {
	const total = task.steps.length;
	if (total === 0) return "";
	const done = task.steps.filter(
		(s) => s.status === TaskStatus.completed || s.status === TaskStatus.skipped,
	).length;
	return `${done}/${total} steps`;
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

interface StatusBadgeProps {
	status: TaskStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
	const color = statusColor(status);
	return <Text color={color}>[{statusBadge(status)}]</Text>;
}

// ─── TaskNode ──────────────────────────────────────────────────────────────────

interface TaskNodeProps {
	task: Task;
	focused?: boolean;
	onPress?: () => void;
}

export function TaskNode({ task, focused = false, onPress }: TaskNodeProps) {
	const color = statusColor(task.status);
	const progress = stepProgress(task);
	const total = task.steps.length;
	const completed = task.steps.filter(
		(s) => s.status === TaskStatus.completed || s.status === TaskStatus.skipped,
	).length;

	return (
		<Box
			flexDirection="column"
			paddingX={1}
			borderStyle={focused ? "single" : undefined}
			borderColor={focused ? "cyan" : undefined}
		>
			<Box flexDirection="row">
				{/* Cursor indicator */}
				<Text color="cyan">{focused ? "›" : " "} </Text>

				{/* Status badge */}
				<StatusBadge status={task.status} />

				<Text> </Text>

				{/* Task goal */}
				<Text color={color} bold={task.status === TaskStatus.running}>
					{task.goal}
				</Text>

				{/* Step progress pill */}
				{progress !== "" && (
					<>
						<Text color="gray"> </Text>
						<Text color="gray" dimColor>
							[{progress}]
						</Text>
					</>
				)}
			</Box>

			{/* Progress bar */}
			{total > 0 && (
				<Box paddingLeft={3}>
					<ProgressBar completed={completed} total={total} />
				</Box>
			)}
		</Box>
	);
}
