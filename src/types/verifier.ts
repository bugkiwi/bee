export type CheckName = "tests" | "lint" | "typecheck" | "runtime";

/** The outcome of a single named verification check (tests, lint, typecheck, runtime). */
export interface VerificationResult {
  check: CheckName;
  passed: boolean;
  output: string;
  duration_ms: number;
  error?: string;
}

/** Aggregated verification outcome for a task, combining all individual check results. */
export interface VerificationSummary {
  task_id: string;
  passed: boolean;
  checks: VerificationResult[];
  total_duration_ms: number;
}
