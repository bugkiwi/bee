import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readJsonFile, writeJsonFile } from "../utils/fs.ts";

describe("writeJsonFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bee-fs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("handles concurrent writes to the same file without tmp rename collisions", async () => {
    const file = join(dir, "state.json");
    const writes = Array.from({ length: 64 }, (_, i) =>
      writeJsonFile(file, { seq: i, text: `value-${i}` })
    );

    await Promise.all(writes);

    const data = await readJsonFile<{ seq: number; text: string }>(file);
    expect(typeof data.seq).toBe("number");
    expect(data.text.startsWith("value-")).toBe(true);

    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
  });
});

