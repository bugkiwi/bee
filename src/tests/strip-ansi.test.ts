import { expect, test, describe } from "bun:test";
import { stripAnsi } from "../utils/strip-ansi.ts";

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1B[31mred text\x1B[0m")).toBe("red text");
  });

  test("removes bold codes", () => {
    expect(stripAnsi("\x1B[1mbold\x1B[0m")).toBe("bold");
  });

  test("passes through plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  test("removes cursor movement codes", () => {
    expect(stripAnsi("\x1B[2J\x1B[H hello")).toBe(" hello");
  });

  test("handles mixed content", () => {
    const input = "\x1B[32m✅ Done\x1B[0m — cost: $0.50";
    expect(stripAnsi(input)).toBe("✅ Done — cost: $0.50");
  });
});
