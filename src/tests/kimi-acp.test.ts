import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatSession } from "../cli/chat.ts";
import type { AcpCommandConfig } from "../providers/acp/commands.ts";
import {
	buildKimiSessionParams,
	extractKimiUpdateText,
	pickKimiPermissionOptionId,
} from "../providers/kimi/acp.ts";
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

async function readJsonLines(path: string): Promise<any[]> {
	const text = await readFile(path, "utf8");
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

describe("buildKimiSessionParams", () => {
	it("always sends an explicit cwd and empty MCP server list", () => {
		expect(buildKimiSessionParams("/tmp/project")).toEqual({
			cwd: "/tmp/project",
			mcpServers: [],
		});
	});
});

describe("pickKimiPermissionOptionId", () => {
	it("prefers session-wide allow over one-off allow and reject", () => {
		expect(
			pickKimiPermissionOptionId([
				{ kind: "reject_once", name: "Reject", optionId: "reject" },
				{ kind: "allow_once", name: "Approve once", optionId: "approve" },
				{
					kind: "allow_always",
					name: "Approve for this session",
					optionId: "approve_for_session",
				},
			]),
		).toBe("approve_for_session");
	});

	it("falls back to the first option when no allow option exists", () => {
		expect(
			pickKimiPermissionOptionId([
				{ kind: "reject_once", name: "Reject", optionId: "reject" },
			]),
		).toBe("reject");
	});
});

describe("extractKimiUpdateText", () => {
	it("extracts text from direct content chunks", () => {
		expect(extractKimiUpdateText({ type: "text", text: "你好" })).toBe("你好");
	});

	it("extracts concatenated text from wrapped tool content", () => {
		expect(
			extractKimiUpdateText([
				{ type: "content", content: { type: "text", text: "foo" } },
				{ type: "content", content: { type: "text", text: "bar" } },
			]),
		).toBe("foobar");
	});
});

describe("kimi stdio ACP integration", () => {
	let baseDir: string;

	beforeEach(async () => {
		baseDir = await mkdtemp(join(tmpdir(), "bee-kimi-acp-test-"));
	});

	afterEach(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	it("handles kimi over the unified stdio ACP flow without acp_base_url", async () => {
		const projectPath = "/Users/test/Work/project-kimi-stdio-acp";
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
});
