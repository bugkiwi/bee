import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const BEE_DIR = ".bee";
const RUNTIME_DIRS = ["tasks", "state", "logs"] as const;

export interface WorkspaceDirs {
  root: string;
  bee: string;
  tasks: string;
  state: string;
  logs: string;
  config: string;
}

export function findWorkspaceRoot(startDir?: string): string {
  const initialDir = resolve(startDir ?? process.cwd());
  let dir = initialDir;

  while (true) {
    if (existsSync(join(dir, BEE_DIR))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return initialDir;
    dir = parent;
  }
}

export function resolveDir(base: string, ...parts: string[]): string {
  return resolve(base, ...parts);
}

function migrateLegacyRuntimeDir(root: string, beeDir: string, name: (typeof RUNTIME_DIRS)[number]): string {
  const modern = join(beeDir, name);
  const legacy = join(root, name);

  if (!existsSync(legacy) || existsSync(modern)) return modern;

  try {
    mkdirSync(beeDir, { recursive: true });
    renameSync(legacy, modern);
    return modern;
  } catch {
    return legacy;
  }
}

export function getWorkspaceDirs(root: string): WorkspaceDirs {
  const bee = join(root, BEE_DIR);
  return {
    root,
    bee,
    tasks: migrateLegacyRuntimeDir(root, bee, "tasks"),
    state: migrateLegacyRuntimeDir(root, bee, "state"),
    logs: migrateLegacyRuntimeDir(root, bee, "logs"),
    config: join(bee, "config.json"),
  };
}
