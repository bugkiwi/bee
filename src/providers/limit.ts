import type { ProviderResult } from "../types/provider.ts";

export type LimitKind = "rate_limit" | "budget_limit" | "api_error" | "timeout";

export interface LimitEvent {
  kind: LimitKind;
  message: string;
  retryable: boolean;
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /quota.?exceeded/i,
  /requests per minute/i,
  /tokens per minute/i,
];

const BUDGET_PATTERNS = [
  /budget.?exceeded/i,
  /max.?budget/i,
  /cost.?limit/i,
  /billing/i,
  /credit/i,
];

const AUTH_PATTERNS = [
  /unauthorized/i,
  /invalid.?api.?key/i,
  /authentication/i,
  /403/,
  /401/,
];

export function detectLimit(result: ProviderResult): LimitEvent | null {
  if (result.success) return null;
  const text = (result.error ?? result.output ?? "").toLowerCase();

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: "rate_limit",
      message: result.error ?? "Rate limit reached",
      retryable: true,
    };
  }
  if (BUDGET_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: "budget_limit",
      message: result.error ?? "Budget/quota exceeded",
      retryable: false,
    };
  }
  if (AUTH_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: "api_error",
      message: result.error ?? "Authentication failed",
      retryable: false,
    };
  }
  if (/timed out/i.test(text)) {
    return {
      kind: "timeout",
      message: result.error ?? "Request timed out",
      retryable: true,
    };
  }
  return null;
}
