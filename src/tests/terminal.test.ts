import { describe, expect, it } from "bun:test";
import { sanitizeTerminalInputChunk } from "../cli/ui/terminal.ts";

describe("sanitizeTerminalInputChunk", () => {
	it("strips stray SGR mouse reports while preserving text and arrow keys", () => {
		const result = sanitizeTerminalInputChunk(
			"\x1b[<65;75;50Mhello\x1b[A\x1b[<66;75;50M",
		);

		expect(result).toEqual({
			clean: "hello\x1b[A",
			remainder: "",
			interceptedCtrlV: false,
		});
	});

	it("keeps partial mouse reports buffered until they complete", () => {
		const partial = sanitizeTerminalInputChunk("\x1b[<65;75");
		expect(partial).toEqual({
			clean: "",
			remainder: "\x1b[<65;75",
			interceptedCtrlV: false,
		});

		const completed = sanitizeTerminalInputChunk(";50Mok", partial.remainder);
		expect(completed).toEqual({
			clean: "ok",
			remainder: "",
			interceptedCtrlV: false,
		});
	});
});
