import type { ProviderResult } from "../../types/provider.ts";

interface ClaudeStreamEvent {
  type: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  result?: string;
  cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  error?: { message: string };
  subtype?: string;
}

export function parseClaudeStream(lines: string[]): ProviderResult {
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
    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch {
      continue;
    }
    rawEvents.push(event);

    switch (event.type) {
      case "assistant": {
        const content = event.message?.content ?? [];
        for (const block of content) {
          if (block.type === "text" && block.text) {
            outputText += block.text;
          }
        }
        if (event.message?.usage) {
          tokensInput = event.message.usage.input_tokens;
          tokensOutput = event.message.usage.output_tokens;
        }
        break;
      }
      case "result": {
        if (event.result) outputText = event.result;
        if (event.cost_usd) costUsd = event.cost_usd;
        if (event.total_input_tokens) tokensInput = event.total_input_tokens;
        if (event.total_output_tokens) tokensOutput = event.total_output_tokens;
        break;
      }
      case "system": {
        if (event.subtype === "init") break;
        break;
      }
      case "error": {
        success = false;
        error = event.error?.message ?? "Unknown error";
        break;
      }
    }
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
