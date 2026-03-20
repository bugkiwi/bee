import { describe, expect, it } from "bun:test";
import { createToolDiffPreview, summarizeToolDiff } from "../utils/diff-preview.ts";

describe("diff preview", () => {
  it("builds an edit diff preview from tool arguments", () => {
    const meta = createToolDiffPreview("Edit", {
      file_path: "src/app.ts",
      old_string: "const a = 1;",
      new_string: "const a = 2;",
    });

    expect(meta).not.toBeNull();
    expect(meta?.patch).toContain("--- a/src/app.ts");
    expect(meta?.patch).toContain("+++ b/src/app.ts");
    expect(meta?.patch).toContain("-const a = 1;");
    expect(meta?.patch).toContain("+const a = 2;");
  });

  it("builds a write diff preview for new files", () => {
    const meta = createToolDiffPreview("Write", {
      file_path: "src/new.ts",
      content: "export const value = 1;\n",
    });

    expect(meta).not.toBeNull();
    expect(meta?.patch).toContain("--- /dev/null");
    expect(meta?.patch).toContain("+++ b/src/new.ts");
    expect(meta?.addedLines).toBe(1);
    expect(meta?.removedLines).toBe(0);
  });

  it("formats a readable summary", () => {
    const summary = summarizeToolDiff({
      kind: "tool-diff",
      filePath: "src/app.ts",
      patch: "+++ b/src/app.ts",
      addedLines: 3,
      removedLines: 1,
      truncated: true,
    });

    expect(summary).toBe("src/app.ts (+3 -1 · truncated)");
  });
});
