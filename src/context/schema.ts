export const SESSION_CONTEXT_VERSION = "1.0.0";

export type ConversationMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string; // ISO 8601
  tool_call_id?: string;
};

export type ToolState = {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "resolved" | "error";
};

export type ProviderMetadata = {
  provider: string;
  model_id: string;
  api_version: string;
  config?: Record<string, unknown>;
};

export type SessionContext = {
  conversation_history: ConversationMessage[];
  tool_states: Record<string, ToolState>;
  provider_metadata: ProviderMetadata;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  resumed_at?: string; // ISO 8601
};
