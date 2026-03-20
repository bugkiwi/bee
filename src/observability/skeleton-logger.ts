import { join } from "node:path";
import { appendJsonLine } from "../utils/fs.ts";

export interface SkeletonLogEntry {
  type: string;
  ts: string;
  nodeId?: string;
  leafId?: string;
  data?: unknown;
}

export class SkeletonLogger {
  private readonly logFile: string;

  constructor(logsDir: string, skeletonId: string) {
    this.logFile = join(logsDir, `skeleton-${skeletonId}.jsonl`);
  }

  async log(entry: Omit<SkeletonLogEntry, "ts">): Promise<void> {
    await appendJsonLine(this.logFile, {
      ...entry,
      ts: new Date().toISOString(),
    });
  }
}
