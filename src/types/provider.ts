import type { AgentTask as Task } from "./task.ts";

/** Configuration passed to a provider when initializing or invoking a run. */
export interface ProviderConfig {
  name: string;
  model?: string;
  timeout_ms?: number;
  max_retries?: number;
  env?: Record<string, string>;
}

/** Structured result returned by a provider after task execution completes. */
export interface ProviderResult {
  success: boolean;
  output: string;
  error?: string;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number;
  provider_run_id?: string;
  raw_events?: unknown[];
}

/** A single streaming event emitted by a provider during execution. */
export interface ProviderEvent {
  provider: string;
  type: "text" | "tool_use" | "result" | "error" | "system" | "line";
  raw: string;
  parsed?: unknown;
  timestamp: string;
}

export type StreamCallback = (event: ProviderEvent) => void;

/** Contract that every AI provider implementation must satisfy. */
export interface IProvider {
  name: string;
  execute(task: Task, traceId: string, onEvent?: StreamCallback): Promise<ProviderResult>;
  cancel(runId: string): Promise<void>;
  health(): Promise<boolean>;
}
