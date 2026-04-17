import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "../agent/loop.ts";
import { DEFAULT_CONFIG, type WorkspaceConfig } from "../types/config.ts";
import type { AgentTask, RunRecord } from "../types/index.ts";
import { readJsonFile } from "../utils/fs.ts";

function makeTempDirs(suffix: string) {
	const base = join(tmpdir(), `bee-run-task-test-${suffix}-${Date.now()}`);
	const dirs = {
		tasks: join(base, "tasks"),
		state: join(base, "state"),
		logs: join(base, "logs"),
	};
	for (const dir of Object.values(dirs)) {
		mkdirSync(dir, { recursive: true });
	}
	return { base, dirs };
}

function makeTask(taskId: string): AgentTask {
	const now = new Date().toISOString();
	return {
		task_id: taskId,
		goal: "Fail the task and persist failure state",
		steps: [{ id: 1, desc: "fail", status: "pending" }],
		acceptance_criteria: ["task fails cleanly"],
		tests_required: false,
		status: "pending",
		provider: "codex",
		created_at: now,
		updated_at: now,
	};
}

const TEST_CONFIG: WorkspaceConfig = {
	...DEFAULT_CONFIG,
	provider: "codex",
	max_retries: 1,
};

describe("runTask final failure handling", () => {
	const createdBases: string[] = [];

	afterEach(() => {
		for (const base of createdBases.splice(0)) {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("throws and persists failed state when provider retries are exhausted", async () => {
		const { base, dirs } = makeTempDirs("provider-fail");
		createdBases.push(base);

		const loop = new AgentLoop(TEST_CONFIG, dirs);
		const task = makeTask("task-run-failure");
		const now = new Date().toISOString();
		const record: RunRecord = {
			run_id: "run_1",
			task_id: task.task_id,
			trace_id: "trace_1",
			provider: "codex",
			started_at: now,
			completed_at: now,
			attempt: 0,
			error: "simulated provider failure",
		};

		(loop as unknown as Record<string, unknown>).executor = {
			execute: async () => ({
				result: {
					success: false,
					output: "",
					error: "simulated provider failure",
				},
				record,
			}),
		};

		await expect(
			(
				loop as unknown as {
					runTask: (task: AgentTask, opts: object) => Promise<void>;
				}
			).runTask(task, {}),
		).rejects.toThrow("simulated provider failure");

		const state = await readJsonFile<{
			current_status: string;
			runs: RunRecord[];
		}>(join(dirs.state, `${task.task_id}.json`));
		const taskFile = await readJsonFile<{ status: string }>(
			join(dirs.tasks, `${task.task_id}.json`),
		);

		expect(state.current_status).toBe("failed");
		expect(state.runs).toHaveLength(1);
		expect(taskFile.status).toBe("failed");
	});
});
