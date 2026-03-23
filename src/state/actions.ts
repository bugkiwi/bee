import type { AppState } from "../types/state.ts";
import { TaskStatus } from "../types/task.ts";

// ─── Action types ─────────────────────────────────────────────────────────────

export interface TaskStartedAction {
	type: "SET_TASK_STARTED";
	task_id: string;
	startedAt: string;
}

export interface TaskDoneAction {
	type: "SET_TASK_DONE";
	task_id: string;
	completedAt: string;
	result?: unknown;
}

export interface TaskFailedAction {
	type: "SET_TASK_FAILED";
	task_id: string;
	completedAt: string;
	error: string;
}

export type AppAction = TaskStartedAction | TaskDoneAction | TaskFailedAction;

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function reducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		case "SET_TASK_STARTED": {
			const task = state.tasks.tasks[action.task_id];
			if (!task) return state;
			return {
				...state,
				tasks: {
					...state.tasks,
					tasks: {
						...state.tasks.tasks,
						[action.task_id]: {
							...task,
							status: TaskStatus.running,
							startedAt: action.startedAt,
						},
					},
				},
			};
		}
		case "SET_TASK_DONE": {
			const task = state.tasks.tasks[action.task_id];
			if (!task) return state;
			return {
				...state,
				tasks: {
					...state.tasks,
					tasks: {
						...state.tasks.tasks,
						[action.task_id]: {
							...task,
							status: TaskStatus.completed,
							completedAt: action.completedAt,
							...(action.result !== undefined
								? { metadata: { ...task.metadata, result: action.result } }
								: {}),
						},
					},
				},
			};
		}
		case "SET_TASK_FAILED": {
			const task = state.tasks.tasks[action.task_id];
			if (!task) return state;
			return {
				...state,
				tasks: {
					...state.tasks,
					tasks: {
						...state.tasks.tasks,
						[action.task_id]: {
							...task,
							status: TaskStatus.failed,
							completedAt: action.completedAt,
							metadata: { ...task.metadata, error: action.error },
						},
					},
				},
			};
		}
	}
}

/**
 * Functional dispatch: accepts a pure state updater and applies it.
 * Callers hold a mutable reference to `AppState` and swap it out on each call.
 */
export type Dispatch = (updater: (state: AppState) => AppState) => void;

// ─── Task lifecycle actions ───────────────────────────────────────────────────

/**
 * Transitions a task to `running` and stamps `startedAt` with the current ISO timestamp.
 * Returns state unchanged if the task does not exist.
 */
export function setTaskStarted(state: AppState, taskId: string): AppState {
	const task = state.tasks.tasks[taskId];
	if (!task) return state;

	return {
		...state,
		tasks: {
			...state.tasks,
			tasks: {
				...state.tasks.tasks,
				[taskId]: {
					...task,
					status: TaskStatus.running,
					startedAt: new Date().toISOString(),
				},
			},
		},
	};
}

/**
 * Transitions a task to `completed`.
 * Returns state unchanged if the task does not exist.
 */
export function setTaskDone(state: AppState, taskId: string): AppState {
	const task = state.tasks.tasks[taskId];
	if (!task) return state;

	return {
		...state,
		tasks: {
			...state.tasks,
			tasks: {
				...state.tasks.tasks,
				[taskId]: {
					...task,
					status: TaskStatus.completed,
				},
			},
		},
	};
}

/**
 * Transitions a task to `failed`, optionally recording an error message in metadata.
 * Returns state unchanged if the task does not exist.
 */
export function setTaskFailed(
	state: AppState,
	taskId: string,
	error?: string,
): AppState {
	const task = state.tasks.tasks[taskId];
	if (!task) return state;

	return {
		...state,
		tasks: {
			...state.tasks,
			tasks: {
				...state.tasks.tasks,
				[taskId]: {
					...task,
					status: TaskStatus.failed,
					metadata: { ...task.metadata, error },
				},
			},
		},
	};
}

// ─── Log actions ──────────────────────────────────────────────────────────────

/**
 * Immutably append a log line to the task identified by taskId.
 * Returns a new AppState. If the task does not exist the state is returned unchanged.
 */
export function appendLogLine(
	state: AppState,
	taskId: string,
	line: string,
): AppState {
	const task = state.tasks.tasks[taskId];
	if (!task) return state;

	return {
		...state,
		tasks: {
			...state.tasks,
			tasks: {
				...state.tasks.tasks,
				[taskId]: {
					...task,
					logLines: [...task.logLines, line],
				},
			},
		},
	};
}
