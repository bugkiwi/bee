import type { SessionContext, ConversationMessage, ToolState } from "../schema.js";
import type {
  GeminiSessionBlob,
  GeminiContent,
  GeminiPart,
  GeminiFunctionCallState,
} from "../fixtures/gemini.fixture.js";

function extractTextFromParts(parts: GeminiPart[]): string {
  return parts
    .filter((p): p is { text: string } => "text" in p)
    .map((p) => p.text)
    .join("");
}

function findCallIdByFunctionName(
  functionCallStates: Record<string, GeminiFunctionCallState>,
  name: string
): string | undefined {
  for (const [id, state] of Object.entries(functionCallStates)) {
    if (state.functionName === name) return id;
  }
  return undefined;
}

function mapContent(
  content: GeminiContent,
  functionCallStates: Record<string, GeminiFunctionCallState>
): ConversationMessage[] {
  const timestamp = content.createTime ?? new Date(0).toISOString();
  const role = content.role === "model" ? "assistant" : "user";
  const messages: ConversationMessage[] = [];

  const textParts = content.parts.filter((p): p is { text: string } => "text" in p);
  const fnCallParts = content.parts.filter(
    (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
      "functionCall" in p
  );
  const fnResponseParts = content.parts.filter(
    (p): p is {
      functionResponse: { name: string; response: { content: unknown } };
    } => "functionResponse" in p
  );

  if (fnResponseParts.length > 0) {
    for (const part of fnResponseParts) {
      const call_id = findCallIdByFunctionName(
        functionCallStates,
        part.functionResponse.name
      );
      messages.push({
        role: "tool",
        content:
          typeof part.functionResponse.response.content === "string"
            ? part.functionResponse.response.content
            : JSON.stringify(part.functionResponse.response.content),
        timestamp,
        ...(call_id !== undefined ? { tool_call_id: call_id } : {}),
      });
    }
    return messages;
  }

  // Text and/or function-call turn
  const text = extractTextFromParts(textParts);
  if (text || fnCallParts.length === 0) {
    messages.push({ role, content: text, timestamp });
  }

  return messages;
}

export function fromGemini(raw: GeminiSessionBlob): SessionContext {
  const conversation_history: ConversationMessage[] = raw.contents.flatMap(
    (content) => mapContent(content, raw.functionCallStates)
  );

  const tool_states: Record<string, ToolState> = {};
  for (const [id, state] of Object.entries(raw.functionCallStates)) {
    tool_states[id] = {
      name: state.functionName,
      args: state.args,
      result: state.response,
      status: state.status,
    };
  }

  return {
    conversation_history,
    tool_states,
    provider_metadata: {
      provider: "gemini",
      model_id: raw.model,
      api_version: raw.apiVersion,
      config: {
        ...(raw.generationConfig ?? {}),
        usage: raw.usageMetadata,
      },
    },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    ...(raw.resumed_at !== undefined ? { resumed_at: raw.resumed_at } : {}),
  };
}
