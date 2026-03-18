export interface AcpRunInput {
  parts: Array<{ content: string; content_type: string }>;
}

export interface AcpRunRequest {
  agent_name: string;
  input: AcpRunInput[];
  mode: "sync" | "async" | "stream";
}

export interface AcpRunStatus {
  run_id: string;
  status: "created" | "in_progress" | "completed" | "failed" | "cancelled";
  output?: Array<{ parts: Array<{ content: string }> }>;
  error?: string;
}

export class AcpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 300_000
  ) {}

  async createRun(request: AcpRunRequest): Promise<AcpRunStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await fetch(`${this.baseUrl}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`ACP error ${resp.status}: ${await resp.text()}`);
      }
      return resp.json() as Promise<AcpRunStatus>;
    } finally {
      clearTimeout(timer);
    }
  }

  async getRun(runId: string): Promise<AcpRunStatus> {
    const resp = await fetch(`${this.baseUrl}/runs/${runId}`);
    if (!resp.ok) {
      throw new Error(`ACP error ${resp.status}: ${await resp.text()}`);
    }
    return resp.json() as Promise<AcpRunStatus>;
  }

  async waitForCompletion(runId: string, pollIntervalMs = 2000): Promise<AcpRunStatus> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getRun(runId);
      if (["completed", "failed", "cancelled"].includes(status.status)) {
        return status;
      }
      await Bun.sleep(pollIntervalMs);
    }
    throw new Error(`ACP run ${runId} timed out`);
  }
}
