import chalk from "chalk";
import type { CostTracker } from "../observability/cost.ts";
import type { Logger } from "../observability/logger.ts";
import type { Tracer } from "../observability/tracer.ts";
import { ContextSelector } from "../plugins/context-selector.ts";
import { Critic } from "../plugins/critic.ts";
import { DiffEngine } from "../plugins/diff-engine.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import type {
	ProviderEvent,
	ProviderResult,
	StreamCallback,
} from "../types/provider.ts";
import type { RunRecord } from "../types/state.ts";
import type { AgentTask as Task } from "../types/task.ts";
import { generateRunId } from "../utils/id.ts";
import { buildPromptWithContext } from "../utils/prompt.ts";

export class TaskExecutor {
	private readonly registry: ProviderRegistry;

	constructor(private readonly config: WorkspaceConfig) {
		this.registry = new ProviderRegistry(config);
	}

	async execute(
		task: Task,
		tracer: Tracer,
		logger: Logger,
		costTracker: CostTracker,
		attempt: number,
		onToolCall?: (name: string, input: Record<string, unknown>) => void,
	): Promise<{ result: ProviderResult; record: RunRecord }> {
		const providerName = task.provider ?? this.config.provider;
		const provider = this.registry.get(providerName);
		const runId = generateRunId();
		const startedAt = new Date().toISOString();

		tracer.emit("provider.request", {
			provider: providerName,
			task_id: task.task_id,
			attempt,
		});
		await logger.log(
			tracer.emit("provider.request", { provider: providerName, attempt }),
		);

		// --- Plugin pipeline: Context Selector ---
		let enrichedTask = task;
		if (this.config.use_plugins) {
			try {
				const workDir = task.working_dir ?? process.cwd();
				const selector = new ContextSelector();
				const contextFiles = await selector.select(task, workDir);
				if (contextFiles.length > 0) {
					// We enrich the task goal with context by creating an augmented task
					// whose goal is replaced by the full prompt-with-context string.
					// Providers call buildPrompt(task) internally; to inject context we
					// override the task object passed only to the prompt utility.
					// Since ClaudeProvider calls buildPrompt internally, we instead
					// pass the enriched prompt via a working_dir-scoped env trick OR
					// by temporarily patching task.goal. The cleanest approach without
					// modifying provider internals is to store the enriched prompt in a
					// well-known place.  We choose to set a synthesised __enriched_prompt
					// property on the task object (cast through unknown).
					const enrichedPrompt = buildPromptWithContext(task, contextFiles);
					// Attach enriched prompt for providers that support it
					enrichedTask = {
						...task,
						_enriched_prompt: enrichedPrompt,
					} as Task & {
						_enriched_prompt: string;
					};
					await logger.log(
						tracer.emit("plugin.context_selector", {
							files_selected: contextFiles.length,
						}),
					);
				}
			} catch {
				// Plugin failures must not crash the task
			}
		}

		const onEvent = createStreamPrinter(providerName, onToolCall);
		let result: ProviderResult;
		try {
			result = await provider.execute(enrichedTask, tracer.traceId, onEvent);
		} catch (err) {
			result = {
				success: false,
				output: "",
				error: err instanceof Error ? err.message : String(err),
			};
		}

		const completedAt = new Date().toISOString();
		const duration = tracer.elapsed();

		await logger.log(
			tracer.emit(
				result.success ? "provider.response" : "task.fail",
				{
					provider: providerName,
					success: result.success,
					error: result.error,
					tokens_in: result.tokens_input,
					tokens_out: result.tokens_output,
				},
				duration,
			),
		);

		if (
			result.tokens_input !== undefined ||
			result.tokens_output !== undefined
		) {
			await costTracker.record({
				traceId: tracer.traceId,
				taskId: task.task_id,
				provider: providerName,
				model: this.config.model ?? providerName,
				tokensInput: result.tokens_input ?? 0,
				tokensOutput: result.tokens_output ?? 0,
			});
		}

		// --- Plugin pipeline: Diff Engine ---
		if (this.config.use_plugins && result.success && result.output) {
			try {
				const workDir = task.working_dir ?? process.cwd();
				const diffEngine = new DiffEngine();
				const diffResult = await diffEngine.apply(result.output, workDir);
				if (diffResult.applied.length > 0 || diffResult.failed.length > 0) {
					await logger.log(
						tracer.emit("plugin.diff_engine", {
							applied: diffResult.applied,
							failed: diffResult.failed,
							summary: diffResult.summary,
						}),
					);
				}
			} catch {
				// Plugin failures must not crash the task
			}
		}

		// --- Plugin pipeline: Critic ---
		if (this.config.use_plugins && result.success && result.output) {
			try {
				const critic = new Critic();
				const critique = await critic.review(result.output, task);
				if (!critique.passed && critique.issues.length > 0) {
					console.warn(
						`[critic] Issues found in ${task.task_id}:\n${critique.issues.map((i) => `  - ${i}`).join("\n")}`,
					);
					await logger.log(
						tracer.emit("plugin.critic", {
							passed: critique.passed,
							issues: critique.issues,
						}),
					);
				}
			} catch {
				// Plugin failures must not crash the task
			}
		}

		const record: RunRecord = {
			run_id: runId,
			task_id: task.task_id,
			trace_id: tracer.traceId,
			provider: providerName,
			started_at: startedAt,
			completed_at: completedAt,
			attempt,
			provider_run_id: result.provider_run_id,
			cost_usd: result.cost_usd,
			tokens_input: result.tokens_input,
			tokens_output: result.tokens_output,
			error: result.error,
		};

		return { result, record };
	}
}

function createStreamPrinter(
	provider: string,
	onToolCall?: (name: string, input: Record<string, unknown>) => void,
): StreamCallback {
	const prefix = chalk.dim(`[${provider}]`);
	return (event: ProviderEvent) => {
		switch (event.type) {
			case "text": {
				const e = event.parsed as {
					message?: { content?: Array<{ type: string; text?: string }> };
				};
				const blocks = e?.message?.content ?? [];
				for (const block of blocks) {
					if (block.type === "text" && block.text) {
						process.stdout.write(block.text);
					}
				}
				break;
			}
			case "tool_use": {
				const e = event.parsed as {
					tool_use?: { name?: string };
					name?: string;
					item?: { type?: string };
					input?: Record<string, unknown>;
				};
				const toolName =
					e?.tool_use?.name ?? e?.name ?? e?.item?.type ?? "tool";
				console.log(`${prefix} ${chalk.cyan(`⚙ ${toolName}`)}`);
				if (onToolCall) {
					onToolCall(e?.name ?? toolName, e?.input ?? {});
				}
				break;
			}
			case "result": {
				const e = event.parsed as {
					cost_usd?: number;
					total_input_tokens?: number;
					total_output_tokens?: number;
				};
				const parts: string[] = [];
				if (e?.total_input_tokens) parts.push(`in:${e.total_input_tokens}`);
				if (e?.total_output_tokens) parts.push(`out:${e.total_output_tokens}`);
				if (e?.cost_usd) parts.push(`$${e.cost_usd.toFixed(4)}`);
				if (parts.length)
					console.log(`${prefix} ${chalk.gray(parts.join(" "))}`);
				break;
			}
			case "error": {
				console.error(`${prefix} ${chalk.red(event.raw.slice(0, 200))}`);
				break;
			}
			case "line": {
				if (event.raw.trim()) {
					process.stdout.write(`${event.raw}\n`);
				}
				break;
			}
		}
	};
}
