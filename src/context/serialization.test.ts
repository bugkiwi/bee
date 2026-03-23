import { expect, test, describe } from "bun:test";
import { serialize, deserialize, ContextDeserializationError } from "./index.ts";
import type { SessionContext } from "./index.ts";
import { fromAnthropic } from "./adapters/anthropic.adapter.ts";
import { fromOpenAI } from "./adapters/openai.adapter.ts";
import { fromGemini } from "./adapters/gemini.adapter.ts";
import { anthropicFixture } from "./fixtures/anthropic.fixture.ts";
import { openaiFixture } from "./fixtures/openai.fixture.ts";
import { geminiFixture } from "./fixtures/gemini.fixture.ts";

const REQUIRED_SESSION_KEYS: (keyof SessionContext)[] = [
  "conversation_history",
  "tool_states",
  "provider_metadata",
  "created_at",
  "updated_at",
];

describe("roundtrip serialization — anthropic fixture", () => {
  const normalized = fromAnthropic(anthropicFixture);

  test("serialize → deserialize equals original normalized value", () => {
    const result = deserialize(serialize(normalized));
    expect(result).toEqual(normalized);
  });

  test("all required SessionContext keys present after roundtrip", () => {
    const result = deserialize(serialize(normalized));
    for (const key of REQUIRED_SESSION_KEYS) {
      expect(key in result).toBe(true);
    }
  });
});

describe("roundtrip serialization — openai fixture", () => {
  const normalized = fromOpenAI(openaiFixture);

  test("serialize → deserialize equals original normalized value", () => {
    const result = deserialize(serialize(normalized));
    expect(result).toEqual(normalized);
  });

  test("all required SessionContext keys present after roundtrip", () => {
    const result = deserialize(serialize(normalized));
    for (const key of REQUIRED_SESSION_KEYS) {
      expect(key in result).toBe(true);
    }
  });
});

describe("roundtrip serialization — gemini fixture", () => {
  const normalized = fromGemini(geminiFixture);

  test("serialize → deserialize equals original normalized value", () => {
    const result = deserialize(serialize(normalized));
    expect(result).toEqual(normalized);
  });

  test("all required SessionContext keys present after roundtrip", () => {
    const result = deserialize(serialize(normalized));
    for (const key of REQUIRED_SESSION_KEYS) {
      expect(key in result).toBe(true);
    }
  });
});

describe("negative — malformed input", () => {
  test("throws ContextDeserializationError (not silent) on completely malformed JSON", () => {
    expect(() => deserialize("{{{not valid json}}}")).toThrow(
      ContextDeserializationError
    );
  });

  test("error message is descriptive for invalid JSON", () => {
    try {
      deserialize("{{{not valid json}}}");
    } catch (e) {
      expect(e).toBeInstanceOf(ContextDeserializationError);
      expect((e as Error).message).toMatch(/invalid json/i);
    }
  });

  test("throws ContextDeserializationError on missing conversation_history", () => {
    const blob = JSON.stringify({
      tool_states: {},
      provider_metadata: { provider: "x", model_id: "m", api_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(() => deserialize(blob)).toThrow(ContextDeserializationError);
  });

  test("error message names the missing field", () => {
    const blob = JSON.stringify({
      tool_states: {},
      provider_metadata: { provider: "x", model_id: "m", api_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    try {
      deserialize(blob);
    } catch (e) {
      expect((e as Error).message).toMatch(/conversation_history/);
    }
  });

  test("throws ContextDeserializationError on invalid role value", () => {
    const blob = JSON.stringify({
      conversation_history: [
        { role: "bot", content: "hi", timestamp: "2026-01-01T00:00:00.000Z" },
      ],
      tool_states: {},
      provider_metadata: { provider: "x", model_id: "m", api_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(() => deserialize(blob)).toThrow(ContextDeserializationError);
  });

  test("throws ContextDeserializationError on invalid tool status value", () => {
    const blob = JSON.stringify({
      conversation_history: [],
      tool_states: {
        t1: { name: "foo", args: {}, status: "running" },
      },
      provider_metadata: { provider: "x", model_id: "m", api_version: "v1" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(() => deserialize(blob)).toThrow(ContextDeserializationError);
  });

  test("does not return partial data — throws instead", () => {
    // Passing a non-string should throw, not return undefined or partial object
    let threw = false;
    try {
      deserialize({ conversation_history: [] } as unknown as string);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(ContextDeserializationError);
    }
    expect(threw).toBe(true);
  });
});

describe("field-completeness across all fixtures", () => {
  const fixtures: [string, SessionContext][] = [
    ["anthropic", fromAnthropic(anthropicFixture)],
    ["openai", fromOpenAI(openaiFixture)],
    ["gemini", fromGemini(geminiFixture)],
  ];

  for (const [provider, normalized] of fixtures) {
    test(`${provider}: every required key present in deserialized output`, () => {
      const result = deserialize(serialize(normalized));
      for (const key of REQUIRED_SESSION_KEYS) {
        expect(result).toHaveProperty(key);
      }
    });

    test(`${provider}: conversation_history is non-empty array after roundtrip`, () => {
      const result = deserialize(serialize(normalized));
      expect(Array.isArray(result.conversation_history)).toBe(true);
      expect(result.conversation_history.length).toBeGreaterThan(0);
    });

    test(`${provider}: provider_metadata has provider, model_id, api_version after roundtrip`, () => {
      const result = deserialize(serialize(normalized));
      expect(typeof result.provider_metadata.provider).toBe("string");
      expect(typeof result.provider_metadata.model_id).toBe("string");
      expect(typeof result.provider_metadata.api_version).toBe("string");
    });

    test(`${provider}: tool_states is an object after roundtrip`, () => {
      const result = deserialize(serialize(normalized));
      expect(typeof result.tool_states).toBe("object");
      expect(Array.isArray(result.tool_states)).toBe(false);
    });
  }
});
