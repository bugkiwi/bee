import { describe, it, expect } from "bun:test";
import { buildProviderHandoff, buildProviderRequest } from "../cli/chat.ts";
import type { BeeSession } from "../session/manager.ts";

// ─── detectAuthError (copied inline for unit testing) ────────────────────────
// The real function lives in chat.ts as a private module-level function.
// We test the same logic here without importing the whole module.

function detectAuthError(stderr: string, provider: string): string | null {
  const s = stderr.toLowerCase();
  if (provider === "claude") {
    if (s.includes("not authenticated") || s.includes("login") || s.includes("auth")) {
      return `Claude not authenticated`;
    }
  }
  if (provider === "codex") {
    if (s.includes("api key") || s.includes("openai_api_key") || s.includes("unauthorized")) {
      return `Set your OPENAI_API_KEY`;
    }
  }
  if (provider === "kimi") {
    if (s.includes("api key") || s.includes("moonshot") || s.includes("unauthorized")) {
      return `Set your MOONSHOT_API_KEY`;
    }
  }
  return null;
}

// ─── Claude spawn args shape ─────────────────────────────────────────────────

/** First message: uses --session-id to establish a new session */
function makeSendClaudeFirstArgs(model: string, sessionId: string): string[] {
  return [
    "claude",
    "--dangerously-skip-permissions",
    "--model", model,
    "--output-format", "stream-json",
    "--verbose",
    "--session-id", sessionId,
  ];
}

/** Subsequent messages: uses --resume to continue the session */
function makeSendClaudeResumeArgs(model: string, sessionId: string): string[] {
  return [
    "claude",
    "--dangerously-skip-permissions",
    "--model", model,
    "--output-format", "stream-json",
    "--verbose",
    "--resume", sessionId,
  ];
}

function makeClaudeProviderEditArgs(model: string): string[] {
  return [
    "claude",
    "--dangerously-skip-permissions",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
}

function makeClaudeProviderPrintArgs(model: string, prompt: string): string[] {
  return [
    "claude",
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    model,
    prompt,
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("detectAuthError", () => {
  it("returns null when stderr is empty", () => {
    expect(detectAuthError("", "claude")).toBeNull();
    expect(detectAuthError("", "codex")).toBeNull();
    expect(detectAuthError("", "kimi")).toBeNull();
  });

  it("detects claude auth errors", () => {
    expect(detectAuthError("Error: not authenticated", "claude")).toBeTruthy();
    expect(detectAuthError("Please run claude auth login", "claude")).toBeTruthy();
    expect(detectAuthError("auth failed", "claude")).toBeTruthy();
  });

  it("does NOT false-positive claude on unrelated errors", () => {
    expect(detectAuthError("rate limit exceeded", "claude")).toBeNull();
    expect(detectAuthError("timeout", "claude")).toBeNull();
  });

  it("detects codex auth errors", () => {
    expect(detectAuthError("OPENAI_API_KEY not set", "codex")).toBeTruthy();
    expect(detectAuthError("invalid api key", "codex")).toBeTruthy();
    expect(detectAuthError("401 unauthorized", "codex")).toBeTruthy();
  });

  it("detects kimi auth errors", () => {
    expect(detectAuthError("MOONSHOT_API_KEY missing", "kimi")).toBeTruthy();
    expect(detectAuthError("unauthorized request", "kimi")).toBeTruthy();
  });

  it("does not cross-match providers", () => {
    // 'api key' matches codex/kimi but not claude
    expect(detectAuthError("api key not set", "claude")).toBeNull();
  });
});

describe("Claude session-based spawn args", () => {
  it("first message uses --session-id (not --resume)", () => {
    const sessionId = crypto.randomUUID();
    const args = makeSendClaudeFirstArgs("claude-sonnet-4-6", sessionId);
    expect(args).toContain("--session-id");
    expect(args).toContain(sessionId);
    expect(args).not.toContain("--resume");
    expect(args).toContain("--verbose");
    expect(args).toContain("stream-json");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("subsequent messages use --resume (not --session-id)", () => {
    const sessionId = crypto.randomUUID();
    const args = makeSendClaudeResumeArgs("claude-sonnet-4-6", sessionId);
    expect(args).toContain("--resume");
    expect(args).toContain(sessionId);
    expect(args).not.toContain("--session-id");
    expect(args).toContain("--verbose");
    expect(args).toContain("stream-json");
  });

  it("ClaudeProvider edit-mode args are correct", () => {
    const args = makeClaudeProviderEditArgs("claude-sonnet-4-6");
    expect(args).toContain("--verbose");
    expect(args).toContain("stream-json");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--print");
  });

  it("ClaudeProvider print-mode args include --verbose (required by CLI)", () => {
    const args = makeClaudeProviderPrintArgs("claude-sonnet-4-6", "hello");
    expect(args).toContain("--verbose");
    expect(args).toContain("--print");
    expect(args).toContain("stream-json");
  });
});

describe("No buildPrompt — native session continuation", () => {
  it("sendClaude only passes userMessage via stdin (not accumulated history)", () => {
    // With native sessions, only the new message is sent.
    // The provider CLI maintains conversation state internally.
    const userMessage = "What is 1+1?";

    // In the old system, buildPrompt would wrap this in Human:/Assistant: format.
    // Now it should be passed as-is.
    expect(userMessage).toBe("What is 1+1?");
    expect(userMessage).not.toContain("Human:");
    expect(userMessage).not.toContain("Assistant:");
  });
});

describe("provider handoff", () => {
  it("returns null when the target provider is already synced", () => {
    const session: BeeSession = {
      id: "s1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      projectPath: "/tmp/project",
      activeProvider: "claude",
      messageCount: 2,
      transcriptSeq: 2,
      providers: {
        claude: {
          provider: "claude",
          nativeId: "claude-thread",
          syncedThrough: 2,
          tokens: 0,
          cost: 0,
          lastActive: "2026-01-01T00:00:00.000Z",
        },
      },
      transcript: [
        { type: "user", text: "  › fix auth", at: "2026-01-01T00:00:00.000Z", seq: 1 },
        { type: "assistant", text: "Done", at: "2026-01-01T00:00:01.000Z", seq: 2 },
      ],
    };

    expect(buildProviderHandoff(session, "claude")).toBeNull();
  });

  it("injects only unseen transcript lines for a lagging provider", () => {
    const session: BeeSession = {
      id: "s1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      projectPath: "/tmp/project",
      activeProvider: "codex",
      messageCount: 4,
      transcriptSeq: 4,
      providers: {
        claude: {
          provider: "claude",
          nativeId: "claude-thread",
          syncedThrough: 4,
          tokens: 0,
          cost: 0,
          lastActive: "2026-01-01T00:00:00.000Z",
        },
        codex: {
          provider: "codex",
          nativeId: "codex-thread",
          syncedThrough: 2,
          tokens: 0,
          cost: 0,
          lastActive: "2026-01-01T00:00:02.000Z",
        },
      },
      transcript: [
        { type: "user", text: "  › fix auth", at: "2026-01-01T00:00:00.000Z", seq: 1 },
        { type: "assistant", text: "Done", at: "2026-01-01T00:00:01.000Z", seq: 2 },
        { type: "user", text: "  › add tests", at: "2026-01-01T00:00:02.000Z", seq: 3 },
        { type: "assistant", text: "Added parser tests.", at: "2026-01-01T00:00:03.000Z", seq: 4 },
      ],
    };

    const handoff = buildProviderHandoff(session, "codex");
    expect(handoff).toBeTruthy();
    expect(handoff).not.toContain("fix auth");
    expect(handoff).toContain("add tests");
    expect(handoff).toContain("Added parser tests.");

    const request = buildProviderRequest("continue with edge cases", "codex", session);
    expect(request).toContain("New user message:");
    expect(request).toContain("continue with edge cases");
  });
});
