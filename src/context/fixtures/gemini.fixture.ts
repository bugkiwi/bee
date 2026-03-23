/**
 * Raw Gemini session blob in provider-native shape.
 * Field names match the Google Gemini (generativelanguage) API — not normalized.
 */

export type GeminiPart =
  | { text: string }
  | {
      functionCall: {
        name: string;
        args: Record<string, unknown>;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: { content: unknown };
      };
    };

export type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
  /** ISO 8601 – added by the bee session layer, not the raw API */
  createTime?: string;
};

export type GeminiFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: {
    type: "OBJECT";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type GeminiTool = {
  functionDeclarations: GeminiFunctionDeclaration[];
};

export type GeminiUsageMetadata = {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
};

export type GeminiFunctionCallState = {
  /** Unique ID assigned by the bee session layer */
  call_id: string;
  functionName: string;
  args: Record<string, unknown>;
  response?: unknown;
  status: "pending" | "resolved" | "error";
};

export type GeminiSessionBlob = {
  /** Provider discriminator */
  _provider: "gemini";
  /** Gemini model identifier (resource name format) */
  model: string;
  /** API version segment used in the endpoint path */
  apiVersion: string;
  /** Optional system instruction (maps to system_instruction in the API) */
  systemInstruction?: GeminiContent;
  /** Conversation turns – Gemini calls this "contents" */
  contents: GeminiContent[];
  /** Tool definitions available in this session */
  tools?: GeminiTool[];
  /** Active / completed function-call states keyed by call_id */
  functionCallStates: Record<string, GeminiFunctionCallState>;
  /** Aggregated token metadata across the session */
  usageMetadata: GeminiUsageMetadata;
  /** ISO 8601 – session creation time */
  created_at: string;
  /** ISO 8601 – last mutation time */
  updated_at: string;
  /** ISO 8601 – present when the session was resumed from a snapshot */
  resumed_at?: string;
  /** Extra generation config forwarded to the API */
  generationConfig?: Record<string, unknown>;
};

export const geminiFixture: GeminiSessionBlob = {
  _provider: "gemini",
  model: "models/gemini-1.5-pro-002",
  apiVersion: "v1beta",
  systemInstruction: {
    role: "user",
    parts: [
      {
        text: "You are a helpful assistant. Always respond concisely and accurately.",
      },
    ],
  },
  contents: [
    {
      role: "user",
      parts: [{ text: "What is the capital of France?" }],
      createTime: "2026-03-21T10:00:00.000Z",
    },
    {
      role: "model",
      parts: [{ text: "The capital of France is Paris." }],
      createTime: "2026-03-21T10:00:01.234Z",
    },
    {
      role: "user",
      parts: [{ text: "Can you look up the current population of Paris?" }],
      createTime: "2026-03-21T10:00:05.000Z",
    },
    {
      role: "model",
      parts: [
        { text: "I'll look that up for you right now." },
        {
          functionCall: {
            name: "web_search",
            args: { query: "current population of Paris 2026" },
          },
        },
      ],
      createTime: "2026-03-21T10:00:06.789Z",
    },
    {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: "web_search",
            response: {
              content:
                "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
            },
          },
        },
      ],
      createTime: "2026-03-21T10:00:08.000Z",
    },
    {
      role: "model",
      parts: [
        {
          text: "Paris has approximately 2.16 million residents in the city proper and around 12.3 million in the greater metropolitan area as of 2026.",
        },
      ],
      createTime: "2026-03-21T10:00:09.456Z",
    },
  ],
  tools: [
    {
      functionDeclarations: [
        {
          name: "web_search",
          description: "Search the web for current information.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: {
                type: "STRING",
                description: "The search query.",
              } as Record<string, unknown>,
            },
            required: ["query"],
          },
        },
      ],
    },
  ],
  functionCallStates: {
    "fc_gemini_0001": {
      call_id: "fc_gemini_0001",
      functionName: "web_search",
      args: { query: "current population of Paris 2026" },
      response:
        "Paris population 2026: approximately 2.16 million (city proper), 12.3 million (metro area).",
      status: "resolved",
    },
  },
  usageMetadata: {
    promptTokenCount: 285,
    candidatesTokenCount: 68,
    totalTokenCount: 353,
    cachedContentTokenCount: 0,
  },
  created_at: "2026-03-21T10:00:00.000Z",
  updated_at: "2026-03-21T10:00:09.456Z",
  generationConfig: {
    maxOutputTokens: 4096,
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
  },
};
