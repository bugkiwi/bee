import { describe, expect, it } from "bun:test";
import {
  getCollapsibleMetaGroupType,
  getContentBodyWidth,
  getContentLineLabel,
  getContentLineText,
  hasContentLineLeadingColumn,
  rowsForBlock,
  summarizeMetaGroup,
  toInlineSummaryText,
} from "../cli/ui/content.ts";

describe("ui content helpers", () => {
  it("strips display prefixes from user, thinking, and tool lines", () => {
    expect(getContentLineText({ type: "user", text: "  › fix this" })).toBe("fix this");
    expect(getContentLineText({ type: "thinking", text: "  💭 planning next step" })).toBe("planning next step");
    expect(getContentLineText({ type: "tool", text: "  📖 rg --files" })).toBe("rg --files");
  });

  it("distinguishes tool groups from thinking groups", () => {
    expect(getCollapsibleMetaGroupType({ type: "tool", text: "  📖 rg --files" })).toBe("tool");
    expect(getCollapsibleMetaGroupType({ type: "thinking", text: "  💭 planning next step" })).toBe("thinking");
    expect(getCollapsibleMetaGroupType({ type: "thinking", text: "  💭 thinking..." })).toBeNull();
  });

  it("summarizes from the first tool line when there is no thinking line", () => {
    const { summary, summarySource } = summarizeMetaGroup([
      { id: "tool-1", type: "tool", text: "  📖 search src/cli/ui" },
      { id: "tool-2", type: "tool", text: "  found 3 files" },
    ]);

    expect(summarySource?.id).toBe("tool-1");
    expect(summary).toBe("search src/cli/ui");
  });

  it("collapses multiline meta summaries into a single line", () => {
    const { summary, full, truncated } = summarizeMetaGroup([
      { id: "think-1", type: "thinking", text: "  💭 plan:\n\n1. add StatusBar\n2. wire App" },
    ]);

    expect(summary).toBe("plan: 1. add StatusBar 2. wire App");
    expect(full).toBe("plan:\n\n1. add StatusBar\n2. wire App");
    expect(truncated).toBe(true);
  });

  it("normalizes inline status labels", () => {
    expect(toInlineSummaryText("  planning\n  next\t step  ")).toBe("planning next step");
  });

  it("counts wrapped rows across newline-separated blocks", () => {
    expect(rowsForBlock("abcd\nefghij", 4)).toBe(3);
  });

  it("reserves label width from the body column", () => {
    expect(getContentBodyWidth(40, true)).toBeLessThan(40);
    expect(getContentBodyWidth(40, false)).toBe(40);
  });

  it("keeps assistant aligned without rendering an ANSWER label", () => {
    expect(getContentLineLabel({ type: "assistant" })).toBeNull();
    expect(hasContentLineLeadingColumn({ type: "assistant" })).toBe(true);
  });
});
