import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SessionManager, projectPathHash } from "../session/manager.ts";

describe("projectPathHash", () => {
  it("converts absolute path to dash-separated hash", () => {
    expect(projectPathHash("/Users/foo/Work/bar")).toBe("-Users-foo-Work-bar");
  });

  it("handles root path", () => {
    expect(projectPathHash("/")).toBe("-");
  });

  it("handles path with multiple slashes", () => {
    expect(projectPathHash("/a/b/c/d")).toBe("-a-b-c-d");
  });
});

describe("SessionManager", () => {
  let baseDir: string;

  beforeEach(async () => {
    // Each test gets its own temp dir as the base (instead of ~/.bee)
    baseDir = await mkdtemp(join(tmpdir(), "bee-session-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("creates a new session with correct fields", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    expect(session.id).toBeTruthy();
    expect(session.projectPath).toBe("/Users/test/Work/project");
    expect(session.activeProvider).toBe("claude");
    expect(session.messageCount).toBe(0);
    expect(session.providers.claude).toBeTruthy();
    expect(session.providers.claude!.nativeId).toBeNull();
    expect(session.providers.claude!.tokens).toBe(0);
  });

  it("loads a saved session by ID", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const created = await mgr.create("claude");
    const loaded = await mgr.load(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.activeProvider).toBe("claude");
  });

  it("returns null for non-existent session", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const loaded = await mgr.load("non-existent-id");
    expect(loaded).toBeNull();
  });

  it("lists sessions newest first", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    await mgr.create("claude");
    await new Promise(r => setTimeout(r, 10));
    const s2 = await mgr.create("codex");

    const sessions = await mgr.list();
    expect(sessions.length).toBe(2);
    expect(sessions[0]!.id).toBe(s2.id); // newest first
  });

  it("loads latest session", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    await mgr.create("claude");
    await new Promise(r => setTimeout(r, 10));
    const s2 = await mgr.create("codex");

    const latest = await mgr.loadLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(s2.id);
  });

  it("returns null when no sessions exist", async () => {
    const mgr = new SessionManager("/Users/test/Work/empty", baseDir);
    const latest = await mgr.loadLatest();
    expect(latest).toBeNull();
  });

  it("binds a native session ID to a provider", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.bindNativeId(session, "claude", "native-uuid-123");

    const loaded = await mgr.load(session.id);
    expect(loaded!.providers.claude!.nativeId).toBe("native-uuid-123");
  });

  it("binds native ID for a new provider", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.bindNativeId(session, "kimi", "kimi-session-abc");

    const loaded = await mgr.load(session.id);
    expect(loaded!.providers.kimi).toBeTruthy();
    expect(loaded!.providers.kimi!.nativeId).toBe("kimi-session-abc");
  });

  it("records token/cost usage", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.addUsage(session, "claude", 1000, 0.05);
    await mgr.addUsage(session, "claude", 500, 0.02);

    const loaded = await mgr.load(session.id);
    expect(loaded!.providers.claude!.tokens).toBe(1500);
    expect(loaded!.providers.claude!.cost).toBeCloseTo(0.07);
  });

  it("switches active provider", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.switchProvider(session, "codex");

    const loaded = await mgr.load(session.id);
    expect(loaded!.activeProvider).toBe("codex");
    expect(loaded!.providers.codex).toBeTruthy();
  });

  it("increments message count", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.recordMessage(session);
    await mgr.recordMessage(session);
    await mgr.recordMessage(session);

    const loaded = await mgr.load(session.id);
    expect(loaded!.messageCount).toBe(3);
  });

  it("deletes a session", async () => {
    const mgr = new SessionManager("/Users/test/Work/project", baseDir);
    const session = await mgr.create("claude");

    await mgr.delete(session.id);
    const loaded = await mgr.load(session.id);
    expect(loaded).toBeNull();
  });

  it("isolates sessions by project path", async () => {
    const mgr1 = new SessionManager("/Users/test/Work/project-a", baseDir);
    const mgr2 = new SessionManager("/Users/test/Work/project-b", baseDir);

    await mgr1.create("claude");
    await mgr2.create("codex");
    await mgr2.create("kimi");

    const list1 = await mgr1.list();
    const list2 = await mgr2.list();
    expect(list1.length).toBe(1);
    expect(list2.length).toBe(2);
  });
});

describe("ChatSession args (unit)", () => {
  it("first call generates --session-id args", () => {
    const sessionId = crypto.randomUUID();
    const model = "claude-sonnet-4-6";
    const args = [
      "claude",
      "--dangerously-skip-permissions",
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
      "--session-id", sessionId,
    ];

    expect(args).toContain("--session-id");
    expect(args).toContain(sessionId);
    expect(args).not.toContain("--resume");
  });

  it("subsequent calls use --resume args", () => {
    const sessionId = crypto.randomUUID();
    const model = "claude-sonnet-4-6";
    const args = [
      "claude",
      "--dangerously-skip-permissions",
      "--model", model,
      "--output-format", "stream-json",
      "--verbose",
      "--resume", sessionId,
    ];

    expect(args).toContain("--resume");
    expect(args).toContain(sessionId);
    expect(args).not.toContain("--session-id");
  });

  it("codex resume args include session ID", () => {
    const sessionId = "abc-123";
    const args = ["codex", "resume", sessionId, "hello"];

    expect(args[0]).toBe("codex");
    expect(args[1]).toBe("resume");
    expect(args[2]).toBe(sessionId);
  });

  it("kimi session args include --session flag", () => {
    const sessionId = "kimi-session-xyz";
    const args = ["kimi", "--session", sessionId, "--print", "hello"];

    expect(args).toContain("--session");
    expect(args).toContain(sessionId);
  });
});
