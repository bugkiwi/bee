import { expect, test, describe } from "bun:test";
import {
  serialize,
  deserialize,
  ContextDeserializationError,
} from "./index.ts";
import type { SessionContext } from "./index.ts";

function buildSessionContext(): SessionContext {
  return {
    conversation_history: [
      {
        role: "user",
        content: "What files are in the current directory?",
        timestamp: "2026-03-21T10:00:00.000Z",
      },
      {
        role: "assistant",
        content: "I'll check that for you.",
        timestamp: "2026-03-21T10:00:01.000Z",
      },
      {
        role: "tool",
        content: "file1.ts\nfile2.ts\npackage.json",
        timestamp: "2026-03-21T10:00:02.000Z",
        tool_call_id: "call_xyz123",
      },
    ],
    tool_states: {
      call_xyz123: {
        name: "bash",
        args: { command: "ls" },
        result: "file1.ts\nfile2.ts\npackage.json",
        status: "resolved",
      },
    },
    provider_metadata: {
      provider: "anthropic",
      model_id: "claude-sonnet-4-6",
      api_version: "2023-06-01",
      config: { temperature: 0.5, max_tokens: 4096 },
    },
    created_at: "2026-03-21T10:00:00.000Z",
    updated_at: "2026-03-21T10:00:02.000Z",
    resumed_at: "2026-03-21T10:00:00.500Z",
  };
}

describe("schema roundtrip", () => {
  test("serialize then deserialize produces deep-equal object", () => {
    const ctx = buildSessionContext();
    const result = deserialize(serialize(ctx));
    expect(result).toEqual(ctx);
  });

  test("serialized string is valid JSON and contains expected top-level keys", () => {
    const ctx = buildSessionContext();
    const json = serialize(ctx);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toHaveProperty("conversation_history");
    expect(parsed).toHaveProperty("tool_states");
    expect(parsed).toHaveProperty("provider_metadata");
    expect(parsed).toHaveProperty("created_at");
    expect(parsed).toHaveProperty("updated_at");
  });

  test("throws ContextDeserializationError when conversation_history is missing", () => {
    const ctx = buildSessionContext();
    const parsed = JSON.parse(serialize(ctx)) as Record<string, unknown>;
    delete parsed["conversation_history"];
    expect(() => deserialize(JSON.stringify(parsed))).toThrow(
      ContextDeserializationError
    );
  });

  test("throws ContextDeserializationError when provider_metadata is missing", () => {
    const ctx = buildSessionContext();
    const parsed = JSON.parse(serialize(ctx)) as Record<string, unknown>;
    delete parsed["provider_metadata"];
    expect(() => deserialize(JSON.stringify(parsed))).toThrow(
      ContextDeserializationError
    );
  });

  test("roundtrip preserves all message fields including tool_call_id", () => {
    const ctx = buildSessionContext();
    const result = deserialize(serialize(ctx));
    const toolMsg = result.conversation_history.find(
      (m) => m.role === "tool"
    );
    expect(toolMsg?.tool_call_id).toBe("call_xyz123");
  });

  test("roundtrip preserves provider_metadata config", () => {
    const ctx = buildSessionContext();
    const result = deserialize(serialize(ctx));
    expect(result.provider_metadata.config).toEqual({
      temperature: 0.5,
      max_tokens: 4096,
    });
  });

  test("roundtrip preserves tool_states with result and status", () => {
    const ctx = buildSessionContext();
    const result = deserialize(serialize(ctx));
    expect(result.tool_states["call_xyz123"]).toEqual({
      name: "bash",
      args: { command: "ls" },
      result: "file1.ts\nfile2.ts\npackage.json",
      status: "resolved",
    });
  });

  test("error thrown has correct name", () => {
    expect.assertions(2);
    try {
      deserialize("{}");
    } catch (e) {
      expect(e).toBeInstanceOf(ContextDeserializationError);
      expect((e as Error).name).toBe("ContextDeserializationError");
    }
  });
});
