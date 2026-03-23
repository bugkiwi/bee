import type {
  SessionContext,
  ConversationMessage,
  ToolState,
  ProviderMetadata,
} from "./schema.js";

export class ContextDeserializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextDeserializationError";
  }
}

const STABLE_SESSION_KEYS: (keyof SessionContext)[] = [
  "conversation_history",
  "tool_states",
  "provider_metadata",
  "created_at",
  "updated_at",
  "resumed_at",
];

export function serialize(ctx: SessionContext): string {
  const ordered: Partial<SessionContext> = {};
  for (const key of STABLE_SESSION_KEYS) {
    if (key in ctx) {
      (ordered as Record<string, unknown>)[key] = ctx[key];
    }
  }
  return JSON.stringify(ordered);
}

function assertString(val: unknown, field: string): string {
  if (typeof val !== "string") {
    throw new ContextDeserializationError(
      `Field "${field}" must be a string, got ${typeof val}`
    );
  }
  return val;
}

function assertRecord(val: unknown, field: string): Record<string, unknown> {
  if (val === null || typeof val !== "object" || Array.isArray(val)) {
    throw new ContextDeserializationError(
      `Field "${field}" must be an object, got ${val === null ? "null" : Array.isArray(val) ? "array" : typeof val}`
    );
  }
  return val as Record<string, unknown>;
}

function validateConversationMessage(
  msg: unknown,
  index: number
): ConversationMessage {
  const m = assertRecord(msg, `conversation_history[${index}]`);
  const role = assertString(m.role, `conversation_history[${index}].role`);
  if (role !== "user" && role !== "assistant" && role !== "tool") {
    throw new ContextDeserializationError(
      `Field "conversation_history[${index}].role" must be "user", "assistant", or "tool", got "${role}"`
    );
  }
  assertString(m.content, `conversation_history[${index}].content`);
  assertString(m.timestamp, `conversation_history[${index}].timestamp`);
  if ("tool_call_id" in m && m.tool_call_id !== undefined) {
    assertString(m.tool_call_id, `conversation_history[${index}].tool_call_id`);
  }
  return m as unknown as ConversationMessage;
}

function validateToolState(val: unknown, key: string): ToolState {
  const s = assertRecord(val, `tool_states.${key}`);
  assertString(s.name, `tool_states.${key}.name`);
  assertRecord(s.args, `tool_states.${key}.args`);
  const status = assertString(s.status, `tool_states.${key}.status`);
  if (status !== "pending" && status !== "resolved" && status !== "error") {
    throw new ContextDeserializationError(
      `Field "tool_states.${key}.status" must be "pending", "resolved", or "error", got "${status}"`
    );
  }
  return s as unknown as ToolState;
}

function validateProviderMetadata(val: unknown): ProviderMetadata {
  const m = assertRecord(val, "provider_metadata");
  assertString(m.provider, "provider_metadata.provider");
  assertString(m.model_id, "provider_metadata.model_id");
  assertString(m.api_version, "provider_metadata.api_version");
  if ("config" in m && m.config !== undefined) {
    assertRecord(m.config, "provider_metadata.config");
  }
  return m as unknown as ProviderMetadata;
}

// UNKNOWN-FIELD POLICY: strip.
// Any keys in the input blob that are not part of the SessionContext schema are
// silently dropped. The returned object is constructed from only schema-defined
// fields, so extra keys can never corrupt or shadow typed properties. This keeps
// deserialized values predictable regardless of the blob's provenance (e.g. an
// older writer that emitted extra diagnostic fields, or a future writer whose
// extended schema is not yet understood by this version).
export function deserialize(blob: unknown): SessionContext {
  if (typeof blob !== "string") {
    throw new ContextDeserializationError(
      `Expected a string, got ${blob === null ? "null" : typeof blob}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch (e) {
    throw new ContextDeserializationError(
      `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const obj = assertRecord(parsed, "<root>");

  if (!("conversation_history" in obj)) {
    throw new ContextDeserializationError(
      'Required field "conversation_history" is missing'
    );
  }
  if (!Array.isArray(obj.conversation_history)) {
    throw new ContextDeserializationError(
      '"conversation_history" must be an array'
    );
  }
  const conversation_history = obj.conversation_history.map((msg, i) =>
    validateConversationMessage(msg, i)
  );

  if (!("tool_states" in obj)) {
    throw new ContextDeserializationError(
      'Required field "tool_states" is missing'
    );
  }
  const rawToolStates = assertRecord(obj.tool_states, "tool_states");
  const tool_states: Record<string, ToolState> = {};
  for (const [key, val] of Object.entries(rawToolStates)) {
    tool_states[key] = validateToolState(val, key);
  }

  if (!("provider_metadata" in obj)) {
    throw new ContextDeserializationError(
      'Required field "provider_metadata" is missing'
    );
  }
  const provider_metadata = validateProviderMetadata(obj.provider_metadata);

  if (!("created_at" in obj)) {
    throw new ContextDeserializationError(
      'Required field "created_at" is missing'
    );
  }
  const created_at = assertString(obj.created_at, "created_at");

  if (!("updated_at" in obj)) {
    throw new ContextDeserializationError(
      'Required field "updated_at" is missing'
    );
  }
  const updated_at = assertString(obj.updated_at, "updated_at");

  const ctx: SessionContext = {
    conversation_history,
    tool_states,
    provider_metadata,
    created_at,
    updated_at,
  };

  if ("resumed_at" in obj && obj.resumed_at !== undefined) {
    ctx.resumed_at = assertString(obj.resumed_at, "resumed_at");
  }

  return ctx;
}
