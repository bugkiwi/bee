import type { SessionContext, ConversationMessage, ToolState } from "../schema.js";
import type {
  AnthropicSessionBlob,
  AnthropicMessage,
  AnthropicContentBlock,
} from "../fixtures/anthropic.fixture.js";

function extractText(content: string | AnthropicContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function mapMessage(msg: AnthropicMessage): ConversationMessage | ConversationMessage[] {
  const timestamp = msg.timestamp ?? new Date(0).toISOString();

  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content, timestamp };
  }

  const toolResultBlocks = msg.content.filter(
    (b): b is { type: "tool_result"; tool_use_id: string; content: string } =>
      b.type === "tool_result"
  );

  if (toolResultBlocks.length > 0) {
    return toolResultBlocks.map((b) => ({
      role: "tool" as const,
      content: b.content,
      timestamp,
      tool_call_id: b.tool_use_id,
    }));
  }

  return { role: msg.role, content: extractText(msg.content), timestamp };
}

export function fromAnthropic(raw: AnthropicSessionBlob): SessionContext {
  const conversation_history: ConversationMessage[] = raw.messages.flatMap(
    (msg) => {
      const mapped = mapMessage(msg);
      return Array.isArray(mapped) ? mapped : [mapped];
    }
  );

  const tool_states: Record<string, ToolState> = {};
  for (const [id, state] of Object.entries(raw.tool_use_states)) {
    tool_states[id] = {
      name: state.name,
      args: state.input,
      result: state.result,
      status: state.status,
    };
  }

  return {
    conversation_history,
    tool_states,
    provider_metadata: {
      provider: "anthropic",
      model_id: raw.model,
      api_version: raw.anthropic_version,
      config: {
        ...(raw.provider_config ?? {}),
        usage: raw.usage,
      },
    },
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    ...(raw.resumed_at !== undefined ? { resumed_at: raw.resumed_at } : {}),
  };
}
