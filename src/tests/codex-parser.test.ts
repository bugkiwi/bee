import { describe, expect, test } from "bun:test";
import { parseCodexLine } from "../providers/codex/index.ts";
import { parseCodexStream } from "../providers/codex/parser.ts";

describe("parseCodexStream", () => {
	test("extracts final agent message, usage, and thread id from current codex JSONL", () => {
		const result = parseCodexStream([
			'{"type":"thread.started","thread_id":"thread-123"}',
			'{"type":"turn.started"}',
			'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"[1,2,3]"}}',
			'{"type":"turn.completed","usage":{"input_tokens":42,"output_tokens":7}}',
		]);

		expect(result.success).toBe(true);
		expect(result.output).toBe("[1,2,3]");
		expect(result.provider_run_id).toBe("thread-123");
		expect(result.tokens_input).toBe(42);
		expect(result.tokens_output).toBe(7);
	});

	test("ignores codex stdin preamble noise", () => {
		const result = parseCodexStream([
			"Reading additional input from stdin...",
			'{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}',
		]);

		expect(result.output).toBe("hello");
	});
});

describe("parseCodexLine", () => {
	test("classifies command execution events as tool_use", () => {
		const event = parseCodexLine(
			'{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"pwd"}}',
			"codex",
		);

		expect(event.type).toBe("tool_use");
	});

	test("classifies agent messages as text", () => {
		const event = parseCodexLine(
			'{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
			"codex",
		);

		expect(event.type).toBe("text");
	});

	test("suppresses the stdin preamble as a system event", () => {
		const event = parseCodexLine(
			"Reading additional input from stdin...",
			"codex",
		);

		expect(event.type).toBe("system");
	});
});
