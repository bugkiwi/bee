import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BEE_DIR, findWorkspaceRoot, getWorkspaceDirs } from "../utils/workspace.ts";

describe("workspace helpers", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bee-workspace-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the nearest parent workspace root", async () => {
    const nested = join(root, "packages", "ui", "src");
    await mkdir(join(root, BEE_DIR), { recursive: true });
    await mkdir(nested, { recursive: true });

    expect(findWorkspaceRoot(nested)).toBe(root);
  });

  it("uses hidden runtime directories under .bee for fresh workspaces", () => {
    const dirs = getWorkspaceDirs(root);

    expect(dirs.bee).toBe(join(root, ".bee"));
    expect(dirs.tasks).toBe(join(root, ".bee", "tasks"));
    expect(dirs.state).toBe(join(root, ".bee", "state"));
    expect(dirs.logs).toBe(join(root, ".bee", "logs"));
    expect(dirs.config).toBe(join(root, ".bee", "config.json"));
  });

  it("migrates legacy root runtime directories into .bee", async () => {
    await mkdir(join(root, "tasks"), { recursive: true });
    await mkdir(join(root, "state"), { recursive: true });
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(join(root, "tasks", "task-1.json"), "{}\n", "utf8");
    await writeFile(join(root, "state", ".session.json"), "{}\n", "utf8");
    await writeFile(join(root, "logs", "trace.jsonl"), "{}\n", "utf8");

    const dirs = getWorkspaceDirs(root);

    expect(dirs.tasks).toBe(join(root, ".bee", "tasks"));
    expect(dirs.state).toBe(join(root, ".bee", "state"));
    expect(dirs.logs).toBe(join(root, ".bee", "logs"));
    expect(existsSync(join(root, ".bee", "tasks", "task-1.json"))).toBe(true);
    expect(existsSync(join(root, ".bee", "state", ".session.json"))).toBe(true);
    expect(existsSync(join(root, ".bee", "logs", "trace.jsonl"))).toBe(true);
    expect(existsSync(join(root, "tasks"))).toBe(false);
    expect(existsSync(join(root, "state"))).toBe(false);
    expect(existsSync(join(root, "logs"))).toBe(false);
  });
});
