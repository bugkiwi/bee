import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  return file.json() as Promise<T>;
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  // Use a unique tmp path to avoid collisions when the same target is written concurrently.
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const payload = JSON.stringify(data, null, 2) + "\n";

  const { rename, unlink } = await import("node:fs/promises");
  let wroteTmp = false;
  try {
    await Bun.write(tmp, payload);
    wroteTmp = true;
    // atomic rename
    await rename(tmp, path);
  } catch (error) {
    if (wroteTmp) {
      try {
        await unlink(tmp);
      } catch {
        // best-effort cleanup
      }
    }
    throw error;
  }
}

export async function appendJsonLine(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const line = JSON.stringify(data) + "\n";
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  await Bun.write(path, existing + line);
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export async function listFiles(dir: string, ext: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f));
}
