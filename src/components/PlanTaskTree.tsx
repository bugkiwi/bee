import { Box, Text } from "ink";
import type { Plan } from "../types/plan.ts";
import { PlanNode } from "./PlanNode.tsx";

interface PlanTaskTreeProps {
	plans: Plan[];
	taskLogs?: Record<string, string[]>;
	terminalWidth?: number;
}

export function PlanTaskTree({
	plans,
	taskLogs,
	terminalWidth,
}: PlanTaskTreeProps) {
	return (
		<Box flexDirection="column" overflowY="hidden" flexGrow={1}>
			{plans.length === 0 ? (
				<Text color="gray" dimColor>
					No plans yet.
				</Text>
			) : (
				plans.map((plan) => (
					<PlanNode
						key={plan.id}
						plan={plan}
						taskLogs={taskLogs}
						terminalWidth={terminalWidth}
					/>
				))
			)}
		</Box>
	);
}
