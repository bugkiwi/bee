import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSession } from "../cli/chat.ts";
import type { AcpCommandConfig } from "../providers/acp/commands.ts";
import { SessionManager } from "../session/manager.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";

function createKimiAcpCommand(logPath: string): AcpCommandConfig {
	return {
		command: "node",
		args: [
			"-e",
			String.raw`
const fs = require("fs");
const logPath = process.env.BEE_TEST_KIMI_ACP_LOG_PATH;
let promptRequestId = null;

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
		if (message.id === 77 && message.result) {
			send({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "kimi-session-1",
					update: {
						sessionUpdate: "tool_call",
						title: "Read: /tmp/demo.ts",
						toolCallId: "tool-1",
					},
				},
			});
			send({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "kimi-session-1",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "kimi via stdio" },
					},
				},
			});
			send({
				jsonrpc: "2.0",
				id: promptRequestId,
				result: { stopReason: "end_turn" },
			});
			continue;
		}
		if (message.method === "initialize") {
			send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
			continue;
		}
		if (message.method === "session/new") {
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { sessionId: "kimi-session-1" },
			});
			continue;
		}
		if (message.method === "session/prompt") {
			promptRequestId = message.id;
			send({
				jsonrpc: "2.0",
				id: 77,
				method: "session/request_permission",
				params: {
					options: [
						{ kind: "reject_once", name: "Reject", optionId: "reject" },
						{
							kind: "allow_always",
							name: "Approve for this session",
							optionId: "approve_for_session",
						},
					],
				},
			});
		}
	}
});
`,
		],
		env: {
			BEE_TEST_KIMI_ACP_LOG_PATH: logPath,
		},
	};
}

function createKimiSplitPlanAcpCommand(logPath: string): AcpCommandConfig {
	return {
		command: "node",
		args: [
			"-e",
			String.raw`
const fs = require("fs");
const logPath = process.env.BEE_TEST_KIMI_ACP_LOG_PATH;

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
				result: { sessionId: "kimi-session-plan" },
			});
			continue;
		}
		if (message.method === "session/prompt") {
			send({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "kimi-session-plan",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "<bee:" },
					},
				},
			});
			send({
				jsonrpc: "2.0",
				method: "session/update",
				params: {
					sessionId: "kimi-session-plan",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "plan goal=\"split marker\"/>" },
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
			BEE_TEST_KIMI_ACP_LOG_PATH: logPath,
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

describe("kimi stdio ACP integration", () => {
	let baseDir: string;

	beforeEach(async () => {
		baseDir = await mkdtemp(join(tmpdir(), "bee-kimi-acp-test-"));
	});

	afterEach(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	it("handles kimi over the unified stdio ACP flow without acp_base_url", async () => {
		const projectPath = join(baseDir, "project-kimi-stdio-acp");
		await mkdir(projectPath, { recursive: true });
		const mgr = new SessionManager(projectPath, baseDir);
		const logPath = join(baseDir, "kimi-acp.jsonl");
		const chat = new ChatSession(
			{
				...DEFAULT_CONFIG,
				provider: "kimi",
				acp_commands: {
					kimi: createKimiAcpCommand(logPath),
				},
			},
			{ projectPath },
		);
		(chat as unknown as { _sessionManager: SessionManager })._sessionManager =
			mgr;
		await chat.initSession();

		const textChunks: string[] = [];
		const toolCalls: Array<{ name: string; preview: string }> = [];
		await chat.send("hello", {
			onText: (text) => textChunks.push(text),
			onTool: (name, preview) => toolCalls.push({ name, preview }),
		});

		expect(textChunks.join("")).toBe("kimi via stdio");
		expect(toolCalls).toEqual([{ name: "Read", preview: "/tmp/demo.ts" }]);

		const messages = await readJsonLines(logPath);
		expect(messages.find((message) => message.method === "session/new")).toBeTruthy();
		expect(
			messages.find((message) => message.id === 77)?.result?.outcome?.optionId,
		).toBe("approve_for_session");
		expect(chat.beeSession?.providers.kimi?.nativeId).toBe("kimi-session-1");
	});

	it("suppresses split plan markers across ACP text chunks", async () => {
		const projectPath = join(baseDir, "project-kimi-stdio-plan-marker");
		await mkdir(projectPath, { recursive: true });
		const logPath = join(baseDir, "kimi-plan-acp.jsonl");
		const chat = new ChatSession(
			{
				...DEFAULT_CONFIG,
				provider: "kimi",
				acp_commands: {
					kimi: createKimiSplitPlanAcpCommand(logPath),
				},
			},
			{ projectPath },
		);

		const textChunks: string[] = [];
		const planGoals: string[] = [];
		await chat.send("plan this", {
			onText: (text) => textChunks.push(text),
			onPlanIntent: (goal) => planGoals.push(goal),
		});

		expect(textChunks).toEqual([]);
		expect(planGoals).toEqual(["split marker"]);
		expect(
			(chat as unknown as { _kimiSessionId: string | null })._kimiSessionId,
		).toBe(
			"kimi-session-plan",
		);
	});
});
