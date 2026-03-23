/**
 * Raw OpenAI session blob in provider-native shape.
 * Field names match the OpenAI Chat Completions API — not normalized.
 */

export type OpenAIFunctionCall = {
  name: string;
  arguments: string; // JSON string
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: OpenAIFunctionCall;
};

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; name?: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      name?: string;
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export type OpenAIFunctionDefinition = {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type OpenAIToolDefinition = {
  type: "function";
  function: OpenAIFunctionDefinition;
};

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens: number;
    audio_tokens: number;
  };
  completion_tokens_details?: {
    reasoning_tokens: number;
    audio_tokens: number;
    accepted_prediction_tokens: number;
    rejected_prediction_tokens: number;
  };
};

export type OpenAIToolCallState = {
  /** Matches the tool_call.id from the assistant message */
  call_id: string;
  function_name: string;
  /** Parsed arguments object */
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "resolved" | "error";
};

export type OpenAISessionBlob = {
  /** Provider discriminator */
  _provider: "openai";
  /** OpenAI model identifier */
  model: string;
  /** API version expressed as a date string (YYYY-MM-DD) */
  api_version: string;
  /** Conversation messages including the system prompt */
  messages: OpenAIMessage[];
  /** Tool definitions available in this session */
  tools?: OpenAIToolDefinition[];
  /** Active / completed tool-call states keyed by call_id */
  tool_call_states: Record<string, OpenAIToolCallState>;
  /** Aggregated token usage across the session */
  usage: OpenAIUsage;
  /** ISO 8601 – session creation time */
  created_at: string;
  /** ISO 8601 – last mutation time */
  updated_at: string;
  /** ISO 8601 – present when the session was resumed from a snapshot */
  resumed_at?: string;
  /** Extra provider config forwarded to the API (temperature, top_p, …) */
  provider_config?: Record<string, unknown>;
};

export const openaiFixture: OpenAISessionBlob = {
  _provider: "openai",
  model: "gpt-4o-2024-11-20",
  api_version: "2024-10-01",
  messages: [
    {
      role: "system",
      content:
        "You are a helpful assistant. Always respond concisely and accurately.",
    },
    {
      role: "user",
      content: "What is the capital of France?",
    },
    {
      role: "assistant",
      content: "The capital of France is Paris.",
    },
    {
      role: "user",
      content: "Can you look up the current population of Paris?",
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_AbCdEfGhIjKlMnOpQrStUvWx",
          type: "function",
          function: {
            name: "web_search",
            arguments: JSON.stringify({ query: "current population of Paris 2026" }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_AbCdEfGhIjKlMnOpQrStUvWx",
      content:
        "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
    },
    {
      role: "assistant",
      content:
        "Paris has approximately 2.16 million residents in the city proper and around 12.3 million in the greater metropolitan area as of 2026.",
    },
  ],
  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for current information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
          },
          required: ["query"],
        },
      },
    },
  ],
  tool_call_states: {
    call_AbCdEfGhIjKlMnOpQrStUvWx: {
      call_id: "call_AbCdEfGhIjKlMnOpQrStUvWx",
      function_name: "web_search",
      arguments: { query: "current population of Paris 2026" },
      result:
        "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
      status: "resolved",
    },
  },
  usage: {
    prompt_tokens: 298,
    completion_tokens: 74,
    total_tokens: 372,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  },
  created_at: "2026-03-21T10:00:00.000Z",
  updated_at: "2026-03-21T10:00:09.456Z",
  provider_config: {
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 1.0,
  },
};
