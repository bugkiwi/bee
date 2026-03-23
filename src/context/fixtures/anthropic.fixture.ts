/**
 * Raw Anthropic session blob in provider-native shape.
 * Field names match the Anthropic Messages API — not normalized.
 */

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
  /** ISO 8601 – added by the bee session layer, not the raw API */
  timestamp?: string;
};

export type AnthropicToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: AnthropicToolInputSchema;
};

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type AnthropicToolUseState = {
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "resolved" | "error";
};

export type AnthropicSessionBlob = {
  /** Provider discriminator */
  _provider: "anthropic";
  /** Anthropic model identifier */
  model: string;
  /** Anthropic API version header value */
  anthropic_version: string;
  /** Optional system prompt */
  system?: string;
  /** Conversation turns */
  messages: AnthropicMessage[];
  /** Tool definitions available in this session */
  tools?: AnthropicTool[];
  /** Active / completed tool-use states keyed by tool_use_id */
  tool_use_states: Record<string, AnthropicToolUseState>;
  /** Aggregated token counts across the session */
  usage: AnthropicUsage;
  /** ISO 8601 – session creation time */
  created_at: string;
  /** ISO 8601 – last mutation time */
  updated_at: string;
  /** ISO 8601 – present when the session was resumed from a snapshot */
  resumed_at?: string;
  /** Extra provider config forwarded to the API (temperature, top_p, …) */
  provider_config?: Record<string, unknown>;
};

export const anthropicFixture: AnthropicSessionBlob = {
  _provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  anthropic_version: "2023-06-01",
  system:
    "You are a helpful assistant. Always respond concisely and accurately.",
  messages: [
    {
      role: "user",
      content: "What is the capital of France?",
      timestamp: "2026-03-21T10:00:00.000Z",
    },
    {
      role: "assistant",
      content: "The capital of France is Paris.",
      timestamp: "2026-03-21T10:00:01.234Z",
    },
    {
      role: "user",
      content: "Can you look up the current population of Paris?",
      timestamp: "2026-03-21T10:00:05.000Z",
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I'll look that up for you right now.",
        },
        {
          type: "tool_use",
          id: "toolu_01XaBcDeFgHiJkLmNoPqRsTu",
          name: "web_search",
          input: { query: "current population of Paris 2026" },
        },
      ],
      timestamp: "2026-03-21T10:00:06.789Z",
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01XaBcDeFgHiJkLmNoPqRsTu",
          content:
            "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
        },
      ],
      timestamp: "2026-03-21T10:00:08.000Z",
    },
    {
      role: "assistant",
      content:
        "Paris has approximately 2.16 million residents in the city proper and around 12.3 million in the greater metropolitan area as of 2026.",
      timestamp: "2026-03-21T10:00:09.456Z",
    },
  ],
  tools: [
    {
      name: "web_search",
      description: "Search the web for current information.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
        },
        required: ["query"],
      },
    },
  ],
  tool_use_states: {
    toolu_01XaBcDeFgHiJkLmNoPqRsTu: {
      tool_use_id: "toolu_01XaBcDeFgHiJkLmNoPqRsTu",
      name: "web_search",
      input: { query: "current population of Paris 2026" },
      result:
        "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
      status: "resolved",
    },
  },
  usage: {
    input_tokens: 312,
    output_tokens: 87,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  created_at: "2026-03-21T10:00:00.000Z",
  updated_at: "2026-03-21T10:00:09.456Z",
  provider_config: {
    max_tokens: 4096,
    temperature: 0.7,
  },
};
