import type { TraceEvent, TraceEventKind } from "../types/observability.ts";
import { generateTraceId, generateRunId } from "../utils/id.ts";

export class Tracer {
  readonly traceId: string;
  readonly runId: string;
  readonly taskId: string;
  private readonly startTime: number;
  private readonly listeners: Array<(event: TraceEvent) => void> = [];

  constructor(taskId: string) {
    this.traceId = generateTraceId();
    this.runId = generateRunId();
    this.taskId = taskId;
    this.startTime = Date.now();
  }

  onEvent(listener: (event: TraceEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(
    kind: TraceEventKind,
    data?: Record<string, unknown>,
    durationMs?: number
  ): TraceEvent {
    const event: TraceEvent = {
      trace_id: this.traceId,
      run_id: this.runId,
      task_id: this.taskId,
      kind,
      timestamp: new Date().toISOString(),
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...(data ? { data } : {}),
    };
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }
}
