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
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, JSON.stringify(data, null, 2) + "\n");
  // atomic rename
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
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
