import { describe, expect, it } from "bun:test";
import {
	createAcpStdioMessageBuffer,
	nextJsonRpcId,
} from "../providers/acp/stdio-client.ts";

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
});
