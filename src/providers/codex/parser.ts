import type { ProviderResult } from "../../types/provider.ts";

interface CodexEvent {
  type?: string;
  message?: string;
  output?: string;
  error?: string;
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
  const rawEvents: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: CodexEvent;
    try {
      event = JSON.parse(trimmed) as CodexEvent;
    } catch {
      if (trimmed) outputText += trimmed + "\n";
      continue;
    }
    rawEvents.push(event);

    if (event.type === "error" || event.error) {
      success = false;
      error = event.error ?? "Unknown error";
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
    raw_events: rawEvents,
  };
}
