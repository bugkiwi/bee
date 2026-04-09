import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSession } from "../cli/chat.ts";
import { resolveAcpAgentName } from "../providers/acp/agents.ts";
import type { AcpCommandConfig } from "../providers/acp/commands.ts";
import { SessionManager, projectPathHash } from "../session/manager.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";

function createFakeAcpCommand(
	provider: string,
	logPath: string,
): AcpCommandConfig {
	return {
		command: "node",
		args: [
			"-e",
			String.raw`
const fs = require("fs");
const provider = process.env.BEE_TEST_ACP_PROVIDER;
const logPath = process.env.BEE_TEST_ACP_LOG_PATH;

function log(message) {
	fs.appendFileSync(logPath, JSON.stringify(message) + "\n");
}

function send(message) {
	process.stdout.write(JSON.stringify(message) + "\n");
}

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		log(message);
		if (message.method === "initialize") {
			send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
			continue;
		}
		if (message.method === "session/new") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { sessionId: provider + "-session-1" },
			});
			continue;
		}
		if (message.method === "session/load") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { sessionId: message.params.sessionId },
			});
			continue;
		}
		if (message.method === "session/prompt") {
			send({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: message.params.sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "reply from " + provider },
					},
				},
			});
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { stopReason: "end_turn" },
			});
		}
	}
});
`,
		],
		env: {
			BEE_TEST_ACP_PROVIDER: provider,
			BEE_TEST_ACP_LOG_PATH: logPath,
		},
	};
}

async function readJsonLines(path: string): Promise<any[]> {
	const text = await readFile(path, "utf8");
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

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
		expect(session.transcriptSeq).toBe(0);
		expect(session.transcript).toEqual([]);
		expect(session.providers.claude).toBeTruthy();
		expect(session.providers.claude?.nativeId).toBeNull();
		expect(session.providers.claude?.syncedThrough).toBe(0);
		expect(session.providers.claude?.tokens).toBe(0);
	});

	it("loads a saved session by ID", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const created = await mgr.create("claude");
		const loaded = await mgr.load(created.id);

		expect(loaded).not.toBeNull();
		expect(loaded?.id).toBe(created.id);
		expect(loaded?.activeProvider).toBe("claude");
	});

	it("returns null for non-existent session", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const loaded = await mgr.load("non-existent-id");
		expect(loaded).toBeNull();
	});

	it("lists sessions newest first", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		await mgr.create("claude");
		await new Promise((r) => setTimeout(r, 10));
		const s2 = await mgr.create("codex");

		const sessions = await mgr.list();
		expect(sessions.length).toBe(2);
		expect(sessions[0]?.id).toBe(s2.id); // newest first
	});

	it("loads latest session", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		await mgr.create("claude");
		await new Promise((r) => setTimeout(r, 10));
		const s2 = await mgr.create("codex");

		const latest = await mgr.loadLatest();
		expect(latest).not.toBeNull();
		expect(latest?.id).toBe(s2.id);
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
		expect(loaded?.providers.claude?.nativeId).toBe("native-uuid-123");
	});

	it("binds native ID for a new provider", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.bindNativeId(session, "kimi", "kimi-session-abc");

		const loaded = await mgr.load(session.id);
		expect(loaded?.providers.kimi).toBeTruthy();
		expect(loaded?.providers.kimi?.nativeId).toBe("kimi-session-abc");
	});

	it("records token/cost usage", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.addUsage(session, "claude", 1000, 0.05);
		await mgr.addUsage(session, "claude", 500, 0.02);

		const loaded = await mgr.load(session.id);
		expect(loaded?.providers.claude?.tokens).toBe(1500);
		expect(loaded?.providers.claude?.cost).toBeCloseTo(0.07);
	});

	it("switches active provider", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.switchProvider(session, "codex");

		const loaded = await mgr.load(session.id);
		expect(loaded?.activeProvider).toBe("codex");
		expect(loaded?.providers.codex).toBeTruthy();
		expect(loaded?.providers.codex?.syncedThrough).toBe(0);
	});

	it("increments message count", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.recordMessage(session);
		await mgr.recordMessage(session);
		await mgr.recordMessage(session);

		const loaded = await mgr.load(session.id);
		expect(loaded?.messageCount).toBe(3);
	});

	it("appends transcript lines", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.appendTranscript(session, [
			{
				type: "user",
				text: "  › hello",
				at: "2026-01-01T00:00:00.000Z",
				seq: 0,
			},
			{ type: "assistant", text: "Hi", at: "2026-01-01T00:00:01.000Z", seq: 0 },
		]);

		const loaded = await mgr.load(session.id);
		expect(loaded?.transcript.length).toBe(2);
		expect(loaded?.transcriptSeq).toBe(2);
		expect(loaded?.transcript[0]?.type).toBe("user");
		expect(loaded?.transcript[0]?.seq).toBe(1);
		expect(loaded?.transcript[1]?.type).toBe("assistant");
		expect(loaded?.transcript[1]?.seq).toBe(2);
	});

	it("marks providers synced through the current transcript sequence", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.appendTranscript(session, [
			{
				type: "user",
				text: "  › hello",
				at: "2026-01-01T00:00:00.000Z",
				seq: 0,
			},
			{ type: "assistant", text: "Hi", at: "2026-01-01T00:00:01.000Z", seq: 0 },
		]);
		await mgr.markProviderSynced(session, "claude");

		const loaded = await mgr.load(session.id);
		expect(loaded?.providers.claude?.syncedThrough).toBe(2);
	});

	it("resets conversation continuity", async () => {
		const mgr = new SessionManager("/Users/test/Work/project", baseDir);
		const session = await mgr.create("claude");

		await mgr.bindNativeId(session, "claude", "native-uuid-123");
		await mgr.recordMessage(session);
		await mgr.appendTranscript(session, [
			{
				type: "user",
				text: "  › test",
				at: "2026-01-01T00:00:00.000Z",
				seq: 0,
			},
		]);
		await mgr.resetConversation(session);

		const loaded = await mgr.load(session.id);
		expect(loaded?.messageCount).toBe(0);
		expect(loaded?.transcriptSeq).toBe(0);
		expect(loaded?.transcript).toEqual([]);
		expect(loaded?.providers.claude?.nativeId).toBeNull();
		expect(loaded?.providers.claude?.syncedThrough).toBe(0);
	});

	it("loads legacy session files without transcript", async () => {
		const projectPath = "/Users/test/Work/project-legacy";
		const mgr = new SessionManager(projectPath, baseDir);
		const sessionId = "legacy-session";
		const hash = projectPathHash(projectPath);
		const sessionsDir = join(baseDir, "projects", hash, "sessions");
		await mkdir(sessionsDir, { recursive: true });

		const rawLegacy = {
			id: sessionId,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			projectPath,
			activeProvider: "claude",
			providers: {
				claude: {
					provider: "claude",
					nativeId: null,
					tokens: 0,
					cost: 0,
					lastActive: "2026-01-01T00:00:00.000Z",
				},
			},
			messageCount: 1,
		};
		await writeFile(
			join(sessionsDir, `${sessionId}.json`),
			JSON.stringify(rawLegacy, null, 2),
			"utf8",
		);

		const loaded = await mgr.load(sessionId);
		expect(loaded).not.toBeNull();
		expect(loaded?.transcriptSeq).toBe(0);
		expect(loaded?.transcript).toEqual([]);
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

describe("ACP provider mapping", () => {
	it("uses ACP defaults for built-in providers", () => {
		expect(resolveAcpAgentName("claude")).toBe("claude-code");
		expect(resolveAcpAgentName("codex")).toBe("codex");
		expect(resolveAcpAgentName("kimi")).toBe("kimi");
	});

	it("allows custom ACP agent names from config", () => {
		expect(
			resolveAcpAgentName("kimi", {
				acp_agent_names: { kimi: "moonshot-kimi" },
			}),
		).toBe("moonshot-kimi");
	});
});

describe("ChatSession initSession", () => {
	let baseDir: string;

	beforeEach(async () => {
		baseDir = await mkdtemp(join(tmpdir(), "bee-chat-session-test-"));
	});

	afterEach(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	it("resumes using a short session-id prefix", async () => {
		const projectPath = "/Users/test/Work/project-chat-resume-prefix";
		const mgr = new SessionManager(projectPath, baseDir);
		const existing = await mgr.create("claude");
		await mgr.recordMessage(existing);

		const config = { ...DEFAULT_CONFIG, provider: "kimi" };
		const chat = new ChatSession(config, { projectPath });
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;

		const resumed = await chat.initSession({
			resumeSessionId: existing.id.slice(0, 8),
		});
		expect(resumed.id).toBe(existing.id);
		expect(chat.beeSession?.id).toBe(existing.id);
		expect(chat.messageCount).toBe(1);
		expect(config.provider).toBe("claude");
	});

	it("throws when explicit resume id is missing and does not create a new session", async () => {
		const projectPath = "/Users/test/Work/project-chat-resume-miss";
		const mgr = new SessionManager(projectPath, baseDir);
		await mgr.create("claude");
		const before = await mgr.list();

		const config = { ...DEFAULT_CONFIG, provider: "kimi" };
		const chat = new ChatSession(config, { projectPath });
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;

		await expect(
			chat.initSession({ resumeSessionId: "deadbeef" }),
		).rejects.toThrow("Session not found in current project: deadbeef");

		const after = await mgr.list();
		expect(after.length).toBe(before.length);
		expect(chat.beeSession).toBeNull();
	});
});

describe("ChatSession switchProvider", () => {
	let baseDir: string;

	beforeEach(async () => {
		baseDir = await mkdtemp(join(tmpdir(), "bee-chat-switch-provider-test-"));
	});

	afterEach(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	it("updates runtime config and persisted active provider for current session", async () => {
		const projectPath = "/Users/test/Work/project-chat-switch-provider";
		const mgr = new SessionManager(projectPath, baseDir);
		const config = { ...DEFAULT_CONFIG, provider: "claude" };
		const chat = new ChatSession(config, { projectPath });
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;

		const session = await chat.initSession();
		expect(session.activeProvider).toBe("claude");

		await chat.switchProvider("kimi");

		expect(config.provider).toBe("kimi");
		expect(chat.beeSession?.activeProvider).toBe("kimi");

		const reloaded = await mgr.load(session.id);
		expect(reloaded).not.toBeNull();
		expect(reloaded?.activeProvider).toBe("kimi");
		expect(reloaded?.providers.kimi).toBeTruthy();
	});

	it("marks the active provider synced after transcript append", async () => {
		const projectPath = "/Users/test/Work/project-chat-sync-provider";
		const mgr = new SessionManager(projectPath, baseDir);
		const config = { ...DEFAULT_CONFIG, provider: "claude" };
		const chat = new ChatSession(config, { projectPath });
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;

		const session = await chat.initSession();
		await chat.appendTranscript([
			{ type: "user", text: "  › fix the parser" },
			{ type: "assistant", text: "Parser updated." },
		]);

		const reloaded = await mgr.load(session.id);
		expect(reloaded).not.toBeNull();
		expect(reloaded?.transcriptSeq).toBe(2);
		expect(reloaded?.providers.claude?.syncedThrough).toBe(2);
	});

	it("persists provider-scoped ACP session ids and reloads the matching provider session", async () => {
		const projectPath = "/Users/test/Work/project-chat-acp-provider-sessions";
		const mgr = new SessionManager(projectPath, baseDir);
		const claudeLog = join(baseDir, "claude-acp.jsonl");
		const codexLog = join(baseDir, "codex-acp.jsonl");
		const config = {
			...DEFAULT_CONFIG,
			provider: "claude",
			acp_commands: {
				claude: createFakeAcpCommand("claude", claudeLog),
				codex: createFakeAcpCommand("codex", codexLog),
			},
		};
		const chat = new ChatSession(config, { projectPath });
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;

		const session = await chat.initSession();
		await chat.send("first", {});
		await chat.switchProvider("codex");
		await chat.send("second", {});
		await chat.switchProvider("claude");
		await chat.send("third", {});

		const reloaded = await mgr.load(session.id);
		expect(reloaded?.providers.claude?.nativeId).toBe("claude-session-1");
		expect(reloaded?.providers.codex?.nativeId).toBe("codex-session-1");

		const claudeMessages = await readJsonLines(claudeLog);
		const codexMessages = await readJsonLines(codexLog);
		expect(
			claudeMessages.filter((message) => message.method === "session/new").length,
		).toBe(1);
		expect(
			claudeMessages
				.filter((message) => message.method === "session/load")
				.at(-1)?.params?.sessionId,
		).toBe("claude-session-1");
		expect(
			codexMessages.filter((message) => message.method === "session/new").length,
		).toBe(1);
	});
});
