export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function generateTaskId(): string {
  return generateId("task");
}

export function generateTraceId(): string {
  return generateId("trace");
}

export function generateRunId(): string {
  return generateId("run");
}
