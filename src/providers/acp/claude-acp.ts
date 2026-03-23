import type { ProviderResult } from "../../types/provider.ts";
import type { AgentTask as Task } from "../../types/task.ts";
import { buildPrompt } from "../../utils/prompt.ts";
import { BaseProvider } from "../base.ts";
import { AcpClient } from "./client.ts";

export class ClaudeAcpProvider extends BaseProvider {
	readonly name = "claude-acp";
	private readonly client: AcpClient;

	constructor(baseUrl: string, timeoutMs = 300_000) {
		super();
		this.client = new AcpClient(baseUrl, timeoutMs);
	}

	async execute(task: Task, _traceId: string): Promise<ProviderResult> {
		const prompt = buildPrompt(task);
		try {
			const run = await this.client.createRun({
				agent_name: "claude-code",
				input: [
					{
						role: "user",
						parts: [{ content: prompt, content_type: "text/plain" }],
					},
				],
				mode: "async",
			});

			const final = await this.client.waitForCompletion(run.run_id);

			if (final.status === "failed") {
				return {
					success: false,
					output: "",
					error:
						typeof final.error === "string"
							? final.error
							: (final.error?.message ?? "ACP run failed"),
				};
			}

			const output =
				final.output
					?.flatMap((o) => o.parts.map((p) => p.content))
					.join("\n") ?? "";

			return {
				success: true,
				output,
				provider_run_id: run.run_id,
			};
		} catch (err) {
			return this.makeError(String(err));
		}
	}
}
