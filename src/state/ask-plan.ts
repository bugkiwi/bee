import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AskPlanSchema } from "../schema/ask-plan.schema.ts";
import type { AskPlan, AskPlanNode, AskPlanNodeStatus, AskPlanStatus } from "../types/ask-plan.ts";
import type { Plan } from "../types/plan.ts";
import { hydrateAskPlanToDisplayPlan } from "../utils/ask-plan-preview.ts";
import { listFiles, readJsonFile, writeJsonFile } from "../utils/fs.ts";

export class AskPlanStore {
  activePlan: Plan | null = null;
  onChange?: (plan: Plan | null) => void;

  constructor(
    private readonly plansDir: string,
    private readonly options: { tasksDir?: string } = {}
  ) {
    mkdirSync(plansDir, { recursive: true });
  }

  setActivePlan(plan: Plan | null): void {
    this.activePlan = plan;
    this.onChange?.(plan);
  }

  private filePath(planId: string): string {
    return join(this.plansDir, `ask-${planId}.json`);
  }

  async save(plan: AskPlan): Promise<void> {
    try {
      await writeJsonFile(this.filePath(plan.id), plan);
      await this.syncActivePlan(plan);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOSPC") throw new Error("Disk full — cannot save ask plan");
      throw err;
    }
  }

  async load(planId: string): Promise<AskPlan | null> {
    try {
      const raw = await readJsonFile(this.filePath(planId));
      const parsed = AskPlanSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data as AskPlan;
    } catch {
      return null;
    }
  }

  async listIncomplete(): Promise<AskPlan[]> {
    const files = await listFiles(this.plansDir, ".json");
    const planFiles = files.filter((f) => f.includes("ask-") && !f.includes(".tmp"));
    const plans: AskPlan[] = [];
    for (const f of planFiles) {
      try {
        const raw = await readJsonFile(f);
        const parsed = AskPlanSchema.safeParse(raw);
        if (!parsed.success) continue;
        const plan = parsed.data as AskPlan;
        if (plan.status !== "done" && plan.status !== "failed") {
          plans.push(plan);
        }
      } catch {
        // skip corrupt files
      }
    }
    return plans;
  }

  async updateStatus(planId: string, status: AskPlanStatus): Promise<void> {
    const plan = await this.load(planId);
    if (!plan) throw new Error(`Ask plan not found: ${planId}`);
    plan.status = status;
    plan.updated_at = new Date().toISOString();
    await this.save(plan);
  }

  async updateNodeStatus(
    planId: string,
    nodeId: string,
    status: AskPlanNodeStatus
  ): Promise<void> {
    const plan = await this.load(planId);
    if (!plan) throw new Error(`Ask plan not found: ${planId}`);
    const node = findNode(plan.root_nodes, nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId} in plan ${planId}`);
    node.status = status;
    plan.updated_at = new Date().toISOString();
    await this.save(plan);
  }

  async setNodeLeafTasks(
    planId: string,
    nodeId: string,
    taskIds: string[]
  ): Promise<void> {
    const plan = await this.load(planId);
    if (!plan) throw new Error(`Ask plan not found: ${planId}`);
    const node = findNode(plan.root_nodes, nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    node.leaf_task_ids = taskIds;
    plan.updated_at = new Date().toISOString();
    await this.save(plan);
  }

  private async syncActivePlan(plan: AskPlan): Promise<void> {
    this.setActivePlan(
      await hydrateAskPlanToDisplayPlan(plan, {
        tasksDir: this.options.tasksDir,
      })
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findNode(nodes: AskPlanNode[], id: string): AskPlanNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.sub_nodes) {
      const found = findNode(node.sub_nodes, id);
      if (found) return found;
    }
  }
  return undefined;
}
