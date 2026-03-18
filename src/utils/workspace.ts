import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

export const BEE_DIR = ".bee";

export function findWorkspaceRoot(startDir?: string): string {
  const dir = resolve(startDir ?? process.cwd());
  if (existsSync(join(dir, BEE_DIR))) return dir;
  return dir;
}

export function resolveDir(base: string, ...parts: string[]): string {
  return resolve(base, ...parts);
}

export function getWorkspaceDirs(root: string) {
  return {
    root,
    tasks: join(root, "tasks"),
    state: join(root, "state"),
    specs: join(root, "specs"),
    logs: join(root, "logs"),
    providers: join(root, "providers"),
    config: join(root, BEE_DIR, "config.json"),
  };
}
