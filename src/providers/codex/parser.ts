import type { ProviderResult } from "../../types/provider.ts";

interface CodexEvent {
	type?: string;
	thread_id?: string;
	message?: string;
	output?: string;
	error?: string | { message?: string };
	item?: {
		type?: string;
		text?: string;
	};
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
	};
	cost_usd?: number;
}

export function parseCodexStream(lines: string[]): ProviderResult {
	let outputText = "";
	let tokensInput = 0;
	let tokensOutput = 0;
	let costUsd = 0;
	let success = true;
	let error: string | undefined;
	let providerRunId: string | undefined;
	const rawEvents: unknown[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let event: CodexEvent;
		try {
			event = JSON.parse(trimmed) as CodexEvent;
		} catch {
			if (!trimmed.startsWith("Reading additional input from stdin")) {
				outputText += `${trimmed}\n`;
			}
			continue;
		}
		rawEvents.push(event);

		if (event.type === "thread.started" && event.thread_id) {
			providerRunId = event.thread_id;
		}

		if (event.type === "error" || event.error) {
			success = false;
			error =
				typeof event.error === "string"
					? event.error
					: (event.error?.message ?? event.message ?? "Unknown error");
		} else if (
			event.type === "item.completed" &&
			event.item?.type === "agent_message" &&
			event.item.text
		) {
			outputText += event.item.text;
		} else if (event.output) {
			outputText += event.output;
		} else if (event.message) {
			outputText += event.message;
		}

		if (event.usage) {
			tokensInput = event.usage.input_tokens ?? 0;
			tokensOutput = event.usage.output_tokens ?? 0;
		}
		if (event.cost_usd) costUsd = event.cost_usd;
	}

	return {
		success,
		output: outputText,
		...(error ? { error } : {}),
		tokens_input: tokensInput,
		tokens_output: tokensOutput,
		cost_usd: costUsd,
		provider_run_id: providerRunId,
		raw_events: rawEvents,
	};
}
