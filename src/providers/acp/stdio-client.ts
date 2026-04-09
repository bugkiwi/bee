import type { AcpCommandConfig } from "./commands.ts";
import type {
	AcpJsonRpcErrorResponse,
	AcpJsonRpcMessage,
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	AcpJsonRpcSuccessResponse,
} from "./client.ts";

interface StdioAcpClientOptions {
	cwd?: string;
	onNotification?: (message: AcpJsonRpcNotification) => void;
	onRequest?: (message: AcpJsonRpcRequest) => Promise<unknown> | unknown;
}

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
	private stderrPromise: Promise<void> | null = null;
	private stderrText = "";

	constructor(
		private readonly commandConfig: AcpCommandConfig,
		private readonly options: StdioAcpClientOptions = {},
	) {}

	async connect(): Promise<void> {
		if (this.proc) return;

		const proc = Bun.spawn(
			[this.commandConfig.command, ...this.commandConfig.args],
			{
				cwd: this.options.cwd,
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					...this.commandConfig.env,
				},
			},
		);

		this.proc = proc;
		this.stderrText = "";

		this.readLoop = this.startReadLoop(proc, this.getStdout(proc));
		this.stderrPromise = this.captureStderr(this.getStderr(proc));

		try {
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
		} catch (error) {
			await this.shutdownProcess(proc);
			throw error;
		}
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

		await this.shutdownProcess(
			this.proc,
			new Error(this.stderrText.trim() || "ACP stdio client closed"),
		);
	}

	private async startReadLoop(
		proc: ReturnType<typeof Bun.spawn>,
		stdout: ReadableStream<Uint8Array>,
	): Promise<void> {
		const reader = stdout.getReader();
		const decoder = new TextDecoder();
		const buffer = createAcpStdioMessageBuffer();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					await this.handleProcessEnd(proc);
					break;
				}
				const chunk = decoder.decode(value, { stream: true });
				for (const message of buffer.push(chunk)) {
					this.handleMessage(message);
				}
			}
		} catch (error) {
			await this.handleProcessEnd(
				proc,
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

	private async handleProcessEnd(
		proc: ReturnType<typeof Bun.spawn>,
		error?: Error,
	): Promise<void> {
		await proc.exited.catch(() => undefined);
		await this.stderrPromise?.catch(() => undefined);
		this.rejectAllPending(error ?? this.buildDisconnectError(proc));
		this.clearCurrentProcess(proc);
	}

	private handleMessage(message: AcpJsonRpcMessage): void {
		if ("method" in message && "id" in message) {
			void this.handleServerRequest(message);
			return;
		}

		if ("method" in message) {
			this.options.onNotification?.(message);
			return;
		}

		if ("id" in message && "result" in message) {
			this.resolvePending(message);
			return;
		}

		if ("error" in message) {
			this.rejectPending(message);
		}
	}

	private async handleServerRequest(message: AcpJsonRpcRequest): Promise<void> {
		try {
			const result = await this.options.onRequest?.(message);
			this.writeMessage({
				jsonrpc: "2.0",
				id: message.id,
				result: result ?? null,
			});
		} catch (error) {
			this.writeMessage({
				jsonrpc: "2.0",
				id: message.id,
				error: {
					message:
						error instanceof Error
							? error.message
							: "ACP server request failed",
				},
			});
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

	private buildDisconnectError(proc: ReturnType<typeof Bun.spawn>): Error {
		const detail = this.stderrText.trim();
		if (detail) return new Error(detail);
		return new Error(
			`ACP stdio client exited before responding (exit code ${proc.exitCode ?? "unknown"})`,
		);
	}

	private async shutdownProcess(
		proc: ReturnType<typeof Bun.spawn>,
		error?: Error,
	): Promise<void> {
		const stdin = proc.stdin;
		if (stdin && typeof stdin !== "number") {
			try {
				await stdin.end();
			} catch {}
		}

		if (proc.exitCode === null) {
			proc.kill();
		}

		await proc.exited.catch(() => undefined);
		await this.readLoop?.catch(() => undefined);
		await this.stderrPromise?.catch(() => undefined);

		this.rejectAllPending(error ?? this.buildDisconnectError(proc));
		this.clearCurrentProcess(proc);
	}

	private clearCurrentProcess(proc: ReturnType<typeof Bun.spawn>): void {
		if (this.proc !== proc) return;
		this.proc = null;
		this.readLoop = null;
		this.stderrPromise = null;
		this.stderrText = "";
	}

	private getStdout(proc: ReturnType<typeof Bun.spawn>): ReadableStream<Uint8Array> {
		const stdout = proc.stdout;
		if (!stdout || typeof stdout === "number") {
			throw new Error("ACP stdio client stdout is not piped");
		}
		return stdout;
	}

	private getStderr(proc: ReturnType<typeof Bun.spawn>): ReadableStream<Uint8Array> {
		const stderr = proc.stderr;
		if (!stderr || typeof stderr === "number") {
			throw new Error("ACP stdio client stderr is not piped");
		}
		return stderr;
	}

	private writeMessage(message: Record<string, unknown>): void {
		if (!this.proc) {
			throw new Error("ACP stdio client is not connected");
		}

		const stdin = this.proc.stdin;
		if (!stdin || typeof stdin === "number") {
			throw new Error("ACP stdio client stdin is not piped");
		}

		stdin.write(`${JSON.stringify(message)}\n`);
	}
}
