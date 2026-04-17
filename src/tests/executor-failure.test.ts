import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskExecutor } from "../agent/executor.ts";
import { CostTracker } from "../observability/cost.ts";
import { Logger } from "../observability/logger.ts";
import { Tracer } from "../observability/tracer.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";
import type { AgentTask, IProvider } from "../types/index.ts";

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `bee-executor-test-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeTask(taskId: string): AgentTask {
	const now = new Date().toISOString();
	return {
		task_id: taskId,
		goal: "Test executor failure handling",
		steps: [{ id: 1, desc: "fail fast", status: "pending" }],
		acceptance_criteria: ["failure is recorded"],
		tests_required: false,
		status: "pending",
		provider: "codex",
		created_at: now,
		updated_at: now,
	};
}

describe("TaskExecutor failure handling", () => {
	const createdDirs: string[] = [];

	afterEach(() => {
		for (const dir of createdDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("converts thrown provider errors into failed ProviderResult records", async () => {
		const logDir = makeTempDir("logs");
		createdDirs.push(logDir);

		const executor = new TaskExecutor({
			...DEFAULT_CONFIG,
			provider: "codex",
			max_retries: 1,
		});
		const failingProvider: IProvider = {
			name: "codex",
			execute: async () => {
				throw new Error("simulated timeout");
			},
			cancel: async () => {},
			health: async () => true,
		};
		(executor as unknown as Record<string, unknown>).registry = {
			get: () => failingProvider,
		};

		const task = makeTask("task-executor-failure");
		const tracer = new Tracer(task.task_id);
		const logger = new Logger(logDir, tracer.traceId);
		const costTracker = new CostTracker(
			join(logDir, "costs.jsonl"),
			DEFAULT_CONFIG,
		);

		const { result, record } = await executor.execute(
			task,
			tracer,
			logger,
			costTracker,
			0,
		);

		expect(result.success).toBe(false);
		expect(result.error).toBe("simulated timeout");
		expect(record.error).toBe("simulated timeout");
		expect(record.provider).toBe("codex");
	});
});
