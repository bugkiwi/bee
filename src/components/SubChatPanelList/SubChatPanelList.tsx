import { Box } from "ink";
import type { AppState } from "../../types/state.ts";
import type { TaskStatus } from "../../types/task.ts";
import { SubChatPanel } from "../SubChatPanel/SubChatPanel.tsx";

interface SubChatPanelListProps {
	appState: AppState;
}

/** Props that will be forwarded to each SubChatPanel instance. */
export interface PanelProps {
	taskId: string;
	title: string;
	status: TaskStatus;
	logLines: string[];
}

/**
 * Pure data helper: derive the ordered list of SubChatPanel prop objects from
 * the given AppState. Exported so it can be unit-tested without rendering Ink.
 */
export function derivePanelProps(appState: AppState): PanelProps[] {
	const { tasks } = appState.tasks;
	const { subChats } = appState.subChats;

	return Object.values(tasks).map((task) => {
		const subChatLogLines = Object.values(subChats)
			.filter((sc) => sc.taskId === task.id)
			.flatMap((sc) => sc.messages.map((m) => m.content));
		const logLines = task.logLines.length > 0 ? task.logLines : subChatLogLines;

		return { taskId: task.id, title: task.goal, status: task.status, logLines };
	});
}

export function SubChatPanelList({ appState }: SubChatPanelListProps) {
	return (
		<Box flexDirection="column">
			{derivePanelProps(appState).map((props) => (
				<SubChatPanel key={props.taskId} {...props} />
			))}
		</Box>
	);
}
