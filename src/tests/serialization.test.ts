import { expect, test, describe } from "bun:test";
import {
  serialize,
  deserialize,
  ContextDeserializationError,
} from "../context/index.ts";
import type { SessionContext } from "../context/index.ts";

const baseCtx: SessionContext = {
  conversation_history: [
    {
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    {
      role: "assistant",
      content: "Hi there",
      timestamp: "2026-01-01T00:00:01.000Z",
    },
    {
      role: "tool",
      content: "result",
      timestamp: "2026-01-01T00:00:02.000Z",
      tool_call_id: "call_abc",
    },
  ],
  tool_states: {
    call_abc: {
      name: "run_bash",
      args: { cmd: "ls" },
      result: "file.txt",
      status: "resolved",
    },
  },
  provider_metadata: {
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    api_version: "2023-06-01",
  },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:02.000Z",
};

describe("serialize", () => {
  test("returns valid JSON string", () => {
    const result = serialize(baseCtx);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test("round-trips correctly", () => {
    const result = deserialize(serialize(baseCtx));
    expect(result).toEqual(baseCtx);
  });

  test("round-trips with resumed_at", () => {
    const ctx: SessionContext = {
      ...baseCtx,
      resumed_at: "2026-01-02T00:00:00.000Z",
    };
    expect(deserialize(serialize(ctx))).toEqual(ctx);
  });

  test("round-trips with provider config", () => {
    const ctx: SessionContext = {
      ...baseCtx,
      provider_metadata: {
        ...baseCtx.provider_metadata,
        config: { temperature: 0.7 },
      },
    };
    expect(deserialize(serialize(ctx))).toEqual(ctx);
  });

  test("produces stable key order", () => {
    const json1 = serialize(baseCtx);
    const shuffled: SessionContext = {
      updated_at: baseCtx.updated_at,
      created_at: baseCtx.created_at,
      provider_metadata: baseCtx.provider_metadata,
      tool_states: baseCtx.tool_states,
      conversation_history: baseCtx.conversation_history,
    };
    const json2 = serialize(shuffled);
    expect(json1).toBe(json2);
  });
});

describe("deserialize", () => {
  test("throws ContextDeserializationError on invalid JSON", () => {
    expect(() => deserialize("not json")).toThrow(ContextDeserializationError);
  });

  test("throws ContextDeserializationError when conversation_history is missing", () => {
    const { conversation_history: _, ...rest } = JSON.parse(serialize(baseCtx));
    expect(() => deserialize(JSON.stringify(rest))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when tool_states is missing", () => {
    const { tool_states: _, ...rest } = JSON.parse(serialize(baseCtx));
    expect(() => deserialize(JSON.stringify(rest))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when provider_metadata is missing", () => {
    const { provider_metadata: _, ...rest } = JSON.parse(serialize(baseCtx));
    expect(() => deserialize(JSON.stringify(rest))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when created_at is missing", () => {
    const { created_at: _, ...rest } = JSON.parse(serialize(baseCtx));
    expect(() => deserialize(JSON.stringify(rest))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when updated_at is missing", () => {
    const { updated_at: _, ...rest } = JSON.parse(serialize(baseCtx));
    expect(() => deserialize(JSON.stringify(rest))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when role is invalid", () => {
    const parsed = JSON.parse(serialize(baseCtx));
    parsed.conversation_history[0].role = "unknown";
    expect(() => deserialize(JSON.stringify(parsed))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when tool status is invalid", () => {
    const parsed = JSON.parse(serialize(baseCtx));
    parsed.tool_states.call_abc.status = "running";
    expect(() => deserialize(JSON.stringify(parsed))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when conversation_history is not array", () => {
    const parsed = JSON.parse(serialize(baseCtx));
    parsed.conversation_history = "not an array";
    expect(() => deserialize(JSON.stringify(parsed))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when root is not object", () => {
    expect(() => deserialize('"a string"')).toThrow(ContextDeserializationError);
  });

  test("error name is ContextDeserializationError", () => {
    try {
      deserialize("{}");
    } catch (e) {
      expect(e).toBeInstanceOf(ContextDeserializationError);
      expect((e as Error).name).toBe("ContextDeserializationError");
    }
  });

  test("omits resumed_at when not present in source", () => {
    const result = deserialize(serialize(baseCtx));
    expect(result.resumed_at).toBeUndefined();
  });

  test("strips unknown top-level fields from input blob", () => {
    const withExtra = {
      ...JSON.parse(serialize(baseCtx)),
      unknown_field: "should be stripped",
      another_extra: { nested: true },
    };
    const result = deserialize(JSON.stringify(withExtra));
    expect(result).not.toHaveProperty("unknown_field");
    expect(result).not.toHaveProperty("another_extra");
  });

  test("schema-defined fields are not corrupted when extra fields are present", () => {
    const withExtra = {
      ...JSON.parse(serialize(baseCtx)),
      conversation_history_extra: "decoy",
      provider: "spoofed",
    };
    const result = deserialize(JSON.stringify(withExtra));
    expect(result.conversation_history).toEqual(baseCtx.conversation_history);
    expect(result.provider_metadata).toEqual(baseCtx.provider_metadata);
    expect(result.created_at).toBe(baseCtx.created_at);
    expect(result.updated_at).toBe(baseCtx.updated_at);
  });
});
