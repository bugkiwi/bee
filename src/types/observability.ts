export type TraceEventKind =
  | "task.start"
  | "task.complete"
  | "task.fail"
  | "step.start"
  | "step.complete"
  | "step.fail"
  | "provider.request"
  | "provider.response"
  | "provider.stream_chunk"
  | "verify.start"
  | "verify.pass"
  | "verify.fail"
  | "retry.attempt"
  | "state.transition"
  | "plugin.context_selector"
  | "plugin.diff_engine"
  | "plugin.critic";

export interface TraceEvent {
  trace_id: string;
  run_id: string;
  task_id: string;
  kind: TraceEventKind;
  timestamp: string;
  duration_ms?: number;
  data?: Record<string, unknown>;
}

export interface CostRecord {
  trace_id: string;
  task_id: string;
  provider: string;
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  recorded_at: string;
}
