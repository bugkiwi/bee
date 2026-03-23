import { Box, Text } from "ink";
import type { PlanStatus } from "../types/plan.ts";
import type { TaskStatus } from "../types/task.ts";

export type Status = PlanStatus | TaskStatus;

const STATUS_COLORS: Record<Status, string> = {
	completed: "green",
	failed: "red",
	paused: "gray",
	pending: "gray",
	running: "blue",
	skipped: "gray",
};

const STATUS_LABELS: Record<Status, string> = {
	completed: "done",
	failed: "failed",
	paused: "paused",
	pending: "pending",
	running: "running",
	skipped: "skipped",
};

export function getStatusColor(status: Status): string {
	return STATUS_COLORS[status];
}

export function getStatusLabel(status: Status): string {
	return STATUS_LABELS[status];
}

interface StatusBadgeProps {
	status: Status;
}

export function StatusBadge({ status }: StatusBadgeProps) {
	const color = getStatusColor(status);
	const label = getStatusLabel(status);

	return (
		<Box borderStyle="round" borderColor={color} paddingX={1}>
			<Text color={color}>{label}</Text>
		</Box>
	);
}
