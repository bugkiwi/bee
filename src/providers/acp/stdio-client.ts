import type { AcpCommandConfig } from "./commands.ts";
import type {
	AcpJsonRpcErrorResponse,
	AcpJsonRpcMessage,
	AcpJsonRpcRequest,
	AcpJsonRpcSuccessResponse,
} from "./client.ts";

export function createAcpStdioMessageBuffer() {
	let remainder = "";
	return {
		push(chunk: string): AcpJsonRpcMessage[] {
			const input = remainder + chunk;
			const lines = input.split("\n");
			remainder = lines.pop() ?? "";
			return lines
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as AcpJsonRpcMessage);
		},
	};
}

let rpcSeq = 0;

export function nextJsonRpcId(): number {
	rpcSeq += 1;
	return rpcSeq;
}

export class StdioAcpClient {
	private proc: ReturnType<typeof Bun.spawn> | null = null;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
		}
	>();
	private readLoop: Promise<void> | null = null;
	private stderrText = "";

	constructor(private readonly commandConfig: AcpCommandConfig) {}

	async connect(): Promise<void> {
		if (this.proc) return;

		this.proc = Bun.spawn(
			[this.commandConfig.command, ...this.commandConfig.args],
			{
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					...this.commandConfig.env,
				},
			},
		);

		const stdout = this.getStdout();
		const stderr = this.getStderr();
		this.readLoop = this.startReadLoop(stdout);
		void this.captureStderr(stderr);

		await this.request("initialize", {
			protocolVersion: 1,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false,
				},
				terminal: false,
			},
			clientInfo: {
				name: "bee",
				version: "0.1.0",
			},
		});

	}

	async request(
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		if (!this.proc) {
			throw new Error("ACP stdio client is not connected");
		}

		const id = nextJsonRpcId();
		const message: AcpJsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		const stdin = this.proc.stdin;
		if (!stdin || typeof stdin === "number") {
			throw new Error("ACP stdio client stdin is not piped");
		}

		const response = new Promise<unknown>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});

		stdin.write(`${JSON.stringify(message)}\n`);
		return response;
	}

	async close(): Promise<void> {
		if (!this.proc) return;

		const proc = this.proc;
		const stdin = proc.stdin;
		if (stdin && typeof stdin !== "number") {
			try {
				await stdin.end();
			} catch {}
		}

		proc.kill();
		await proc.exited;
		await this.readLoop?.catch(() => undefined);

		this.rejectAllPending(
			new Error(this.stderrText.trim() || "ACP stdio client closed"),
		);
		this.proc = null;
		this.readLoop = null;
	}

	private async startReadLoop(
		stdout: ReadableStream<Uint8Array>,
	): Promise<void> {
		const reader = stdout.getReader();
		const decoder = new TextDecoder();
		const buffer = createAcpStdioMessageBuffer();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value, { stream: true });
				for (const message of buffer.push(chunk)) {
					this.handleMessage(message);
				}
			}
		} catch (error) {
			this.rejectAllPending(
				error instanceof Error
					? error
					: new Error("ACP stdio client failed to read stdout"),
			);
			throw error;
		} finally {
			reader.releaseLock();
		}
	}

	private async captureStderr(
		stderr: ReadableStream<Uint8Array>,
	): Promise<void> {
		const text = await new Response(stderr).text().catch(() => "");
		this.stderrText = text;
	}

	private handleMessage(message: AcpJsonRpcMessage): void {
		if ("id" in message && "result" in message) {
			this.resolvePending(message);
			return;
		}

		if ("error" in message) {
			this.rejectPending(message);
		}
	}

	private resolvePending(message: AcpJsonRpcSuccessResponse): void {
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		pending.resolve(message.result);
	}

	private rejectPending(message: AcpJsonRpcErrorResponse): void {
		if (message.id == null) {
			this.rejectAllPending(
				new Error(message.error.message || "ACP JSON-RPC request failed"),
			);
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		pending.reject(
			new Error(message.error.message || "ACP JSON-RPC request failed"),
		);
	}

	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.reject(error);
		}
	}

	private getStdout(): ReadableStream<Uint8Array> {
		if (!this.proc) {
			throw new Error("ACP stdio client is not connected");
		}
		const stdout = this.proc.stdout;
		if (!stdout || typeof stdout === "number") {
			throw new Error("ACP stdio client stdout is not piped");
		}
		return stdout;
	}

	private getStderr(): ReadableStream<Uint8Array> {
		if (!this.proc) {
			throw new Error("ACP stdio client is not connected");
		}
		const stderr = this.proc.stderr;
		if (!stderr || typeof stderr === "number") {
			throw new Error("ACP stdio client stderr is not piped");
		}
		return stderr;
	}
}
