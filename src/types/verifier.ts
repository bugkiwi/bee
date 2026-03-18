export type CheckName = "tests" | "lint" | "typecheck" | "runtime";

export interface VerificationResult {
  check: CheckName;
  passed: boolean;
  output: string;
  duration_ms: number;
  error?: string;
}

export interface VerificationSummary {
  task_id: string;
  passed: boolean;
  checks: VerificationResult[];
  total_duration_ms: number;
}
