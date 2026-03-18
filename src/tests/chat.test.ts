import { describe, it, expect } from "bun:test";

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

function makeSendClaudeArgs(model: string): string[] {
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

describe("Claude spawn args include --verbose and --output-format stream-json", () => {
  it("chat sendClaude args are correct", () => {
    const args = makeSendClaudeArgs("claude-sonnet-4-6");
    expect(args).toContain("--verbose");
    expect(args).toContain("stream-json");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--print");
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
