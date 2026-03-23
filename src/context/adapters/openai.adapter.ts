import type { SessionContext, ConversationMessage, ToolState } from "../schema.js";
import type { OpenAISessionBlob, OpenAIMessage } from "../fixtures/openai.fixture.js";

function mapMessage(
  msg: OpenAIMessage,
  fallbackTimestamp: string
): ConversationMessage | null {
  if (msg.role === "system") {
    // System prompt is captured in provider_metadata.config — not a conversation turn
    return null;
  }

  if (msg.role === "tool") {
    return {
      role: "tool",
      content: msg.content,
      timestamp: fallbackTimestamp,
      tool_call_id: msg.tool_call_id,
    };
  }

  if (msg.role === "assistant") {
    return {
      role: "assistant",
      content: msg.content ?? "",
      timestamp: fallbackTimestamp,
    };
  }

  // user
  return {
    role: "user",
    content: msg.content,
    timestamp: fallbackTimestamp,
  };
}

export function fromOpenAI(raw: OpenAISessionBlob): SessionContext {
  const systemMsg = raw.messages.find((m) => m.role === "system");

  const conversation_history: ConversationMessage[] = raw.messages
    .map((msg) => mapMessage(msg, raw.created_at))
    .filter((m): m is ConversationMessage => m !== null);

  const tool_states: Record<string, ToolState> = {};
  for (const [id, state] of Object.entries(raw.tool_call_states)) {
    tool_states[id] = {
      name: state.function_name,
      args: state.arguments,
      result: state.result,
      status: state.status,
    };
  }

  return {
    conversation_history,
    tool_states,
    provider_metadata: {
      provider: "openai",
      model_id: raw.model,
      api_version: raw.api_version,
      config: {
        ...(raw.provider_config ?? {}),
        ...(systemMsg ? { system_prompt: systemMsg.content } : {}),
        usage: raw.usage,
      },
    },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    ...(raw.resumed_at !== undefined ? { resumed_at: raw.resumed_at } : {}),
  };
}
