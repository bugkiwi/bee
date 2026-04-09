export interface AcpMessagePart {
	content: string;
	content_type: string;
	name?: string;
	content_encoding?: string;
	content_url?: string;
	metadata?: Record<string, unknown>;
}

export interface AcpMessage {
	role?: string;
	parts: AcpMessagePart[];
	created_at?: string;
	completed_at?: string;
}

export interface AcpRunRequest {
	agent_name: string;
	input: AcpMessage[];
	session_id?: string;
	session?: {
		id?: string;
		history?: string[];
		state?: string;
	};
	mode: "sync" | "async" | "stream";
}

export interface AcpRunError {
	code?: string;
	message: string;
	data?: unknown;
}

export interface AcpRunStatus {
	agent_name?: string;
	run_id: string;
	status:
		| "created"
		| "in-progress"
		| "in_progress"
		| "awaiting"
		| "cancelling"
		| "cancelled"
		| "completed"
		| "failed";
	output?: AcpMessage[];
	error?: AcpRunError | string;
	session_id?: string;
	await_request?: Record<string, unknown>;
	created_at?: string;
	finished_at?: string;
}

export interface AcpJsonRpcError {
	code?: number;
	message: string;
	data?: unknown;
}

export interface AcpJsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

export interface AcpJsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

export interface AcpJsonRpcSuccessResponse {
	jsonrpc: "2.0";
	id: number;
	result: unknown;
}

export interface AcpJsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: number | null;
	error: AcpJsonRpcError;
}

export type AcpJsonRpcMessage =
	| AcpJsonRpcRequest
	| AcpJsonRpcNotification
	| AcpJsonRpcSuccessResponse
	| AcpJsonRpcErrorResponse;

function isTerminalStatus(status: AcpRunStatus["status"]): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "cancelled" ||
		status === "awaiting"
	);
}

export class AcpClient {
	constructor(
		private readonly baseUrl: string,
		private readonly timeoutMs = 300_000,
	) {}

	async createRun(request: AcpRunRequest): Promise<AcpRunStatus> {
		return this.fetchJson(`${this.baseUrl}/runs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
	}

	async getRun(runId: string): Promise<AcpRunStatus> {
		return this.fetchJson(`${this.baseUrl}/runs/${runId}`);
	}

	async waitForCompletion(
		runId: string,
		pollIntervalMs = 2000,
	): Promise<AcpRunStatus> {
		const deadline = Date.now() + this.timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.getRun(runId);
			if (isTerminalStatus(status.status)) {
				return status;
			}
			await Bun.sleep(pollIntervalMs);
		}
		throw new Error(`ACP run ${runId} timed out`);
	}

	private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const resp = await fetch(url, {
				...init,
				signal: controller.signal,
			});
			if (!resp.ok) {
				throw new Error(`ACP error ${resp.status}: ${await resp.text()}`);
			}
			return resp.json() as Promise<T>;
		} finally {
			clearTimeout(timer);
		}
	}
}
