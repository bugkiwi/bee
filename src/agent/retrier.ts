import type { StateFile } from "../types/state.ts";

export interface RetryPolicy {
  max_attempts: number;
  backoff_ms: number;
  backoff_multiplier: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 3,
  backoff_ms: 5_000,
  backoff_multiplier: 2.0,
  jitter: true,
};

export class Retrier {
  constructor(private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  shouldRetry(state: StateFile): boolean {
    return state.runs.length < this.policy.max_attempts;
  }

  attemptCount(state: StateFile): number {
    return state.runs.length;
  }

  async waitBeforeRetry(attempt: number): Promise<void> {
    let delay = this.policy.backoff_ms * Math.pow(this.policy.backoff_multiplier, attempt);
    if (this.policy.jitter) {
      delay *= 0.8 + Math.random() * 0.4; // ±20% jitter
    }
    await Bun.sleep(Math.round(delay));
  }
}
