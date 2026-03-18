import type { CostRecord } from "../types/observability.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import { appendJsonLine } from "../utils/fs.ts";

export class CostTracker {
  private records: CostRecord[] = [];
  private readonly costLedger: string;
  private readonly config: WorkspaceConfig;

  constructor(costLedger: string, config: WorkspaceConfig) {
    this.costLedger = costLedger;
    this.config = config;
  }

  async record(params: {
    traceId: string;
    taskId: string;
    provider: string;
    model: string;
    tokensInput: number;
    tokensOutput: number;
  }): Promise<CostRecord> {
    const model = params.model;
    const priceEntry = this.config.price_table?.[model];
    const costUsd = priceEntry
      ? (params.tokensInput / 1_000_000) * priceEntry.input_per_1m +
        (params.tokensOutput / 1_000_000) * priceEntry.output_per_1m
      : 0;

    const record: CostRecord = {
      trace_id: params.traceId,
      task_id: params.taskId,
      provider: params.provider,
      model,
      tokens_input: params.tokensInput,
      tokens_output: params.tokensOutput,
      cost_usd: costUsd,
      recorded_at: new Date().toISOString(),
    };

    this.records.push(record);
    await appendJsonLine(this.costLedger, record);
    return record;
  }

  totalCost(): number {
    return this.records.reduce((sum, r) => sum + r.cost_usd, 0);
  }

  summary(): string {
    const total = this.totalCost();
    const totalIn = this.records.reduce((s, r) => s + r.tokens_input, 0);
    const totalOut = this.records.reduce((s, r) => s + r.tokens_output, 0);
    return `Tokens: ${totalIn}in / ${totalOut}out | Cost: $${total.toFixed(4)}`;
  }
}
