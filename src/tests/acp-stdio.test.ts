import { describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAcpStdioMessageBuffer,
	nextJsonRpcId,
	StdioAcpClient,
} from "../providers/acp/stdio-client.ts";
import type { AcpCommandConfig } from "../providers/acp/commands.ts";

function createNodeCommandConfig(script: string): AcpCommandConfig {
	return {
		command: "node",
		args: ["-e", script],
		env: {},
	};
}

async function observeOutcome<T>(
	promise: Promise<T>,
	timeoutMs = 300,
): Promise<
	| { status: "resolved"; value: T }
	| { status: "rejected"; error: unknown }
	| { status: "timed_out" }
> {
	return Promise.race([
		promise.then(
			(value) => ({ status: "resolved" as const, value }),
			(error) => ({ status: "rejected" as const, error }),
		),
		Bun.sleep(timeoutMs).then(() => ({ status: "timed_out" as const })),
	]);
}

describe("stdio ACP runtime", () => {
	it("buffers newline-delimited ACP JSON-RPC messages", () => {
		const buffer = createAcpStdioMessageBuffer();
		expect(
			buffer.push('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n'),
		).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: true } }]);
	});

	it("keeps partial ACP lines until the next chunk", () => {
		const buffer = createAcpStdioMessageBuffer();
		expect(buffer.push('{"jsonrpc":"2.0"')).toEqual([]);
		expect(buffer.push(',"id":2,"result":{"ok":true}}\n')).toEqual([
			{ jsonrpc: "2.0", id: 2, result: { ok: true } },
		]);
	});

	it("increments JSON-RPC ids monotonically", () => {
		const first = nextJsonRpcId();
		const second = nextJsonRpcId();

		expect(second).toBeGreaterThan(first);
	});

	it("matches JSON-RPC responses to requests over stdio", async () => {
		const client = new StdioAcpClient(
			createNodeCommandConfig(`
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { initialized: true },
			}) + "\\n");
		} else if (message.method === "ping") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { echoed: message.params?.value ?? null },
			}) + "\\n");
		}
	}
});
`),
		);

		try {
			await client.connect();
			await expect(client.request("ping", { value: 42 })).resolves.toEqual({
				echoed: 42,
			});
		} finally {
			await client.close();
		}
	});

	it("spawns the ACP subprocess in the provided cwd", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "bee-acp-cwd-"));
		const resolvedCwd = await realpath(cwd);
		const client = new StdioAcpClient(
			createNodeCommandConfig(`
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { initialized: true },
			}) + "\\n");
		} else if (message.method === "ping") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { cwd: process.cwd() },
			}) + "\\n");
		}
	}
});
`),
			{ cwd },
		);

		try {
			await client.connect();
			await expect(client.request("ping", {})).resolves.toEqual({
				cwd: resolvedCwd,
			});
		} finally {
			await client.close();
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("rejects connect when stdio closes before initialize responds", async () => {
		const client = new StdioAcpClient(
			createNodeCommandConfig(`process.exit(0);`),
		);

		const outcome = await observeOutcome(client.connect());
		expect(outcome.status).toBe("rejected");
	});

	it("accepts a final initialize response frame without a trailing newline", async () => {
		const client = new StdioAcpClient(
			createNodeCommandConfig(`
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { initialized: true },
			}));
			process.exit(0);
		}
	}
});
`),
		);

		await expect(client.connect()).resolves.toBeUndefined();
	});

	it("rejects pending requests when stdio closes before a response arrives", async () => {
		const client = new StdioAcpClient(
			createNodeCommandConfig(`
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { initialized: true },
			}) + "\\n");
			continue;
		}
		process.exit(0);
	}
});
`),
		);

		try {
			await client.connect();
			const outcome = await observeOutcome(client.request("ping", { value: 1 }));
			expect(outcome.status).toBe("rejected");
		} finally {
			await client.close();
		}
	});

	it("allows connect retry after initialize failure", async () => {
		const statePath = `/tmp/bee-acp-stdio-${process.pid}-${Date.now()}.txt`;
		const commandConfig = createNodeCommandConfig(`
const fs = require("fs");
const statePath = process.env.BEE_STDIO_RETRY_STATE_PATH;
const attempts = Number(fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "0") + 1;
fs.writeFileSync(statePath, String(attempts));
if (attempts === 1) {
	process.exit(0);
}
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: { initialized: true, attempts },
			}) + "\\n");
		}
	}
});
`);
		commandConfig.env.BEE_STDIO_RETRY_STATE_PATH = statePath;
		const client = new StdioAcpClient(commandConfig);

		try {
			const first = await observeOutcome(client.connect());
			expect(first.status).toBe("rejected");

			await expect(client.connect()).resolves.toBeUndefined();
		} finally {
			await client.close();
			await Bun.file(statePath)
				.delete()
				.catch(() => undefined);
		}
	});
});
