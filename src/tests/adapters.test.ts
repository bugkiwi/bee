import { expect, test, describe } from "bun:test";
import { fromAnthropic } from "../context/adapters/anthropic.adapter.js";
import { fromOpenAI } from "../context/adapters/openai.adapter.js";
import { fromGemini } from "../context/adapters/gemini.adapter.js";
import { fromAnthropic as indexFromAnthropic, fromOpenAI as indexFromOpenAI, fromGemini as indexFromGemini } from "../context/adapters/index.js";
import { anthropicFixture } from "../context/fixtures/anthropic.fixture.js";
import { openaiFixture } from "../context/fixtures/openai.fixture.js";
import { geminiFixture } from "../context/fixtures/gemini.fixture.js";

describe("fromAnthropic", () => {
  test("returns a SessionContext with all required fields", () => {
    const ctx = fromAnthropic(anthropicFixture);
    expect(ctx).toHaveProperty("conversation_history");
    expect(ctx).toHaveProperty("tool_states");
    expect(ctx).toHaveProperty("provider_metadata");
    expect(ctx).toHaveProperty("created_at");
    expect(ctx).toHaveProperty("updated_at");
  });

  test("maps provider_metadata correctly", () => {
    const ctx = fromAnthropic(anthropicFixture);
    expect(ctx.provider_metadata.provider).toBe("anthropic");
    expect(ctx.provider_metadata.model_id).toBe("claude-3-5-sonnet-20241022");
    expect(ctx.provider_metadata.api_version).toBe("2023-06-01");
  });

  test("preserves created_at and updated_at", () => {
    const ctx = fromAnthropic(anthropicFixture);
    expect(ctx.created_at).toBe(anthropicFixture.created_at);
    expect(ctx.updated_at).toBe(anthropicFixture.updated_at);
  });

  test("maps string-content messages to conversation_history", () => {
    const ctx = fromAnthropic(anthropicFixture);
    const firstUser = ctx.conversation_history.find((m) => m.role === "user");
    expect(firstUser?.content).toBe("What is the capital of France?");
  });

  test("maps array-content assistant message (text + tool_use) to single assistant message", () => {
    const ctx = fromAnthropic(anthropicFixture);
    const assistantWithTool = ctx.conversation_history.find(
      (m) => m.role === "assistant" && m.content.includes("look that up")
    );
    expect(assistantWithTool).toBeDefined();
    expect(assistantWithTool?.role).toBe("assistant");
  });

  test("maps tool_result blocks to tool messages with tool_call_id", () => {
    const ctx = fromAnthropic(anthropicFixture);
    const toolMsg = ctx.conversation_history.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe("toolu_01XaBcDeFgHiJkLmNoPqRsTu");
    expect(toolMsg?.content).toContain("2.16 million");
  });

  test("maps tool_use_states to tool_states with canonical fields", () => {
    const ctx = fromAnthropic(anthropicFixture);
    const state = ctx.tool_states["toolu_01XaBcDeFgHiJkLmNoPqRsTu"]!;
    expect(state).toBeDefined();
    expect(state.name).toBe("web_search");
    expect(state.args).toEqual({ query: "current population of Paris 2026" });
    expect(state.status).toBe("resolved");
  });

  test("includes usage in provider_metadata.config", () => {
    const ctx = fromAnthropic(anthropicFixture);
    expect(ctx.provider_metadata.config?.usage).toEqual(anthropicFixture.usage);
  });

  test("includes provider_config values in provider_metadata.config", () => {
    const ctx = fromAnthropic(anthropicFixture);
    expect(ctx.provider_metadata.config?.max_tokens).toBe(4096);
    expect(ctx.provider_metadata.config?.temperature).toBe(0.7);
  });

  test("omits resumed_at when not set", () => {
    const { resumed_at: _, ...fixture } = anthropicFixture;
    const ctx = fromAnthropic({ ...fixture, _provider: "anthropic" });
    expect(ctx.resumed_at).toBeUndefined();
  });

  test("re-export from index works", () => {
    const ctx = indexFromAnthropic(anthropicFixture);
    expect(ctx.provider_metadata.provider).toBe("anthropic");
  });
});

describe("fromOpenAI", () => {
  test("returns a SessionContext with all required fields", () => {
    const ctx = fromOpenAI(openaiFixture);
    expect(ctx).toHaveProperty("conversation_history");
    expect(ctx).toHaveProperty("tool_states");
    expect(ctx).toHaveProperty("provider_metadata");
    expect(ctx).toHaveProperty("created_at");
    expect(ctx).toHaveProperty("updated_at");
  });

  test("maps provider_metadata correctly", () => {
    const ctx = fromOpenAI(openaiFixture);
    expect(ctx.provider_metadata.provider).toBe("openai");
    expect(ctx.provider_metadata.model_id).toBe("gpt-4o-2024-11-20");
    expect(ctx.provider_metadata.api_version).toBe("2024-10-01");
  });

  test("excludes system messages from conversation_history", () => {
    const ctx = fromOpenAI(openaiFixture);
    const systemMsg = ctx.conversation_history.find((m) => (m.role as string) === "system");
    expect(systemMsg).toBeUndefined();
  });

  test("captures system prompt in provider_metadata.config", () => {
    const ctx = fromOpenAI(openaiFixture);
    expect(ctx.provider_metadata.config?.system_prompt).toContain("helpful assistant");
  });

  test("maps user messages correctly", () => {
    const ctx = fromOpenAI(openaiFixture);
    const userMsg = ctx.conversation_history.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("What is the capital of France?");
  });

  test("maps assistant message with null content to empty string", () => {
    const ctx = fromOpenAI(openaiFixture);
    const assistantWithToolCall = ctx.conversation_history.find(
      (m) => m.role === "assistant" && m.content === ""
    );
    expect(assistantWithToolCall).toBeDefined();
  });

  test("maps tool messages with tool_call_id", () => {
    const ctx = fromOpenAI(openaiFixture);
    const toolMsg = ctx.conversation_history.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe("call_AbCdEfGhIjKlMnOpQrStUvWx");
    expect(toolMsg?.content).toContain("2.16 million");
  });

  test("maps tool_call_states to tool_states with canonical fields", () => {
    const ctx = fromOpenAI(openaiFixture);
    const state = ctx.tool_states["call_AbCdEfGhIjKlMnOpQrStUvWx"]!;
    expect(state).toBeDefined();
    expect(state.name).toBe("web_search");
    expect(state.args).toEqual({ query: "current population of Paris 2026" });
    expect(state.status).toBe("resolved");
  });

  test("includes usage in provider_metadata.config", () => {
    const ctx = fromOpenAI(openaiFixture);
    expect(ctx.provider_metadata.config?.usage).toEqual(openaiFixture.usage);
  });

  test("preserves created_at and updated_at", () => {
    const ctx = fromOpenAI(openaiFixture);
    expect(ctx.created_at).toBe(openaiFixture.created_at);
    expect(ctx.updated_at).toBe(openaiFixture.updated_at);
  });

  test("omits resumed_at when not set", () => {
    const { resumed_at: _, ...fixture } = openaiFixture;
    const ctx = fromOpenAI({ ...fixture, _provider: "openai" });
    expect(ctx.resumed_at).toBeUndefined();
  });

  test("re-export from index works", () => {
    const ctx = indexFromOpenAI(openaiFixture);
    expect(ctx.provider_metadata.provider).toBe("openai");
  });
});

describe("fromGemini", () => {
  test("returns a SessionContext with all required fields", () => {
    const ctx = fromGemini(geminiFixture);
    expect(ctx).toHaveProperty("conversation_history");
    expect(ctx).toHaveProperty("tool_states");
    expect(ctx).toHaveProperty("provider_metadata");
    expect(ctx).toHaveProperty("created_at");
    expect(ctx).toHaveProperty("updated_at");
  });

  test("maps provider_metadata correctly", () => {
    const ctx = fromGemini(geminiFixture);
    expect(ctx.provider_metadata.provider).toBe("gemini");
    expect(ctx.provider_metadata.model_id).toBe("models/gemini-1.5-pro-002");
    expect(ctx.provider_metadata.api_version).toBe("v1beta");
  });

  test("maps model role to assistant", () => {
    const ctx = fromGemini(geminiFixture);
    const assistantMsg = ctx.conversation_history.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).toContain("Paris");
  });

  test("maps user text content correctly", () => {
    const ctx = fromGemini(geminiFixture);
    const userMsg = ctx.conversation_history.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("What is the capital of France?");
  });

  test("maps functionResponse parts to tool messages", () => {
    const ctx = fromGemini(geminiFixture);
    const toolMsg = ctx.conversation_history.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.content).toContain("2.16 million");
  });

  test("tool message gets tool_call_id from functionCallStates", () => {
    const ctx = fromGemini(geminiFixture);
    const toolMsg = ctx.conversation_history.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("fc_gemini_0001");
  });

  test("maps functionCallStates to tool_states with canonical fields", () => {
    const ctx = fromGemini(geminiFixture);
    const state = ctx.tool_states["fc_gemini_0001"]!;
    expect(state).toBeDefined();
    expect(state.name).toBe("web_search");
    expect(state.args).toEqual({ query: "current population of Paris 2026" });
    expect(state.status).toBe("resolved");
  });

  test("includes usageMetadata in provider_metadata.config", () => {
    const ctx = fromGemini(geminiFixture);
    expect(ctx.provider_metadata.config?.usage).toEqual(geminiFixture.usageMetadata);
  });

  test("includes generationConfig values in provider_metadata.config", () => {
    const ctx = fromGemini(geminiFixture);
    expect(ctx.provider_metadata.config?.temperature).toBe(0.7);
    expect(ctx.provider_metadata.config?.maxOutputTokens).toBe(4096);
  });

  test("preserves created_at and updated_at", () => {
    const ctx = fromGemini(geminiFixture);
    expect(ctx.created_at).toBe(geminiFixture.created_at);
    expect(ctx.updated_at).toBe(geminiFixture.updated_at);
  });

  test("omits resumed_at when not set", () => {
    const { resumed_at: _, ...fixture } = geminiFixture;
    const ctx = fromGemini({ ...fixture, _provider: "gemini" });
    expect(ctx.resumed_at).toBeUndefined();
  });

  test("re-export from index works", () => {
    const ctx = indexFromGemini(geminiFixture);
    expect(ctx.provider_metadata.provider).toBe("gemini");
  });
});
