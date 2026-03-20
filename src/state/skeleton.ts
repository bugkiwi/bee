import { join } from "node:path";
import type { PlanSkeleton, SkeletonNodeStatus } from "../types/skeleton.ts";
import { PlanSkeletonSchema } from "../schema/skeleton.schema.ts";
import { readJsonFile, writeJsonFile, listFiles } from "../utils/fs.ts";

export class SkeletonStore {
  constructor(private readonly stateDir: string) {}

  private filePath(skeletonId: string): string {
    return join(this.stateDir, `skeleton-${skeletonId}.json`);
  }

  async save(skeleton: PlanSkeleton): Promise<void> {
    try {
      await writeJsonFile(this.filePath(skeleton.id), skeleton);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOSPC") {
        throw new Error("Disk full — cannot checkpoint skeleton");
      }
      throw err;
    }
  }

  async load(skeletonId: string): Promise<PlanSkeleton | null> {
    try {
      const raw = await readJsonFile(this.filePath(skeletonId));
      const parsed = PlanSkeletonSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data as PlanSkeleton;
    } catch {
      return null;
    }
  }

  async listIncomplete(): Promise<PlanSkeleton[]> {
    const files = await listFiles(this.stateDir, ".json");
    const skeletonFiles = files.filter((f) =>
      f.includes("skeleton-") && !f.includes(".tmp")
    );
    const skeletons: PlanSkeleton[] = [];
    for (const f of skeletonFiles) {
      try {
        const raw = await readJsonFile(f);
        const parsed = PlanSkeletonSchema.safeParse(raw);
        if (!parsed.success) continue;
        const sk = parsed.data as PlanSkeleton;
        // Incomplete = at least one node not done
        if (sk.nodes.some((n) => n.status !== "done")) {
          skeletons.push(sk);
        }
      } catch {
        // skip corrupt files
      }
    }
    return skeletons;
  }

  async markNode(
    skeletonId: string,
    nodeId: string,
    status: SkeletonNodeStatus
  ): Promise<void> {
    const sk = await this.load(skeletonId);
    if (!sk) throw new Error(`Skeleton not found: ${skeletonId}`);
    const node = sk.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId} in skeleton ${skeletonId}`);
    node.status = status;
    await this.save(sk);
  }

  async markNodeRunning(skeletonId: string, nodeId: string): Promise<void> {
    return this.markNode(skeletonId, nodeId, "running");
  }

  async markNodeDone(skeletonId: string, nodeId: string): Promise<void> {
    return this.markNode(skeletonId, nodeId, "done");
  }

  async markNodeFailed(skeletonId: string, nodeId: string): Promise<void> {
    return this.markNode(skeletonId, nodeId, "failed");
  }
}
