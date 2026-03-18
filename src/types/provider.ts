import type { Task } from "./task.ts";

export interface ProviderConfig {
  name: string;
  model?: string;
  timeout_ms?: number;
  max_retries?: number;
  env?: Record<string, string>;
}

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

export interface ProviderEvent {
  provider: string;
  type: "text" | "tool_use" | "result" | "error" | "system" | "line";
  raw: string;
  parsed?: unknown;
  timestamp: string;
}

export type StreamCallback = (event: ProviderEvent) => void;

export interface IProvider {
  name: string;
  execute(task: Task, traceId: string, onEvent?: StreamCallback): Promise<ProviderResult>;
  cancel(runId: string): Promise<void>;
  health(): Promise<boolean>;
}
