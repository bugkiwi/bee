import chalk from "chalk";
import { resolveAcpAgentName } from "../providers/acp/agents.ts";
import type {
	AcpJsonRpcNotification,
	AcpJsonRpcRequest,
	AcpMessage,
	AcpRunRequest,
	AcpRunStatus,
} from "../providers/acp/client.ts";
import { AcpClient } from "../providers/acp/client.ts";
import { getAcpCommandConfig } from "../providers/acp/commands.ts";
import { StdioAcpClient } from "../providers/acp/stdio-client.ts";
import type { BeeSession, BeeTranscriptLine } from "../session/manager.ts";
import { SessionManager } from "../session/manager.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import type { ToolDiffMeta } from "../types/transcript.ts";
import { createToolDiffPreview } from "../utils/diff-preview.ts";
import { stripAnsi } from "../utils/strip-ansi.ts";

// ─── Content block types ──────────────────────────────────────────────────────

interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: Record<string, unknown>;
}

// ─── Tool emoji + preview ─────────────────────────────────────────────────────

const TOOL_EMOJI: Record<string, string> = {
	Read: "📖",
	Write: "✍️",
	Edit: "✏️",
	Bash: "🖥️",
	Glob: "🔍",
	Grep: "🔍",
	WebFetch: "🌐",
	WebSearch: "🌐",
	Agent: "🤖",
	TodoWrite: "📋",
	NotebookEdit: "📓",
};

function toolEmoji(name: string): string {
	return TOOL_EMOJI[name] ?? "🔧";
}

function toolPreview(name: string, args: Record<string, unknown>): string {
	const shorten = (s: string, n = 60) =>
		s.length > n ? `${s.slice(0, n - 1)}…` : s;
	if (
		(name === "Read" || name === "Write" || name === "Edit") &&
		args.file_path
	)
		return shorten(String(args.file_path));
	if (name === "Bash" && args.command) return shorten(String(args.command));
	if ((name === "Glob" || name === "Grep") && (args.pattern ?? args.query))
		return shorten(String(args.pattern ?? args.query));
	if (name === "WebFetch" && args.url) return shorten(String(args.url));
	if (name === "WebSearch" && args.query) return shorten(String(args.query));
	const raw = JSON.stringify(args);
	return shorten(raw);
}

// ─── ToolTracker — in-place single-line tool display ─────────────────────────

interface ToolCall {
	name: string;
	preview: string;
}

export interface ToolTrackerStats {
	count: number;
	toolCounts: Map<string, number>;
	linesChanged: number;
}

interface ToolTrackerOptions {
	write?: (text: string) => void;
	onTool?: (name: string, preview: string) => void;
	onToolDiff?: (meta: ToolDiffMeta) => void;
	onSummary?: (summary: string) => void;
}

class ToolTracker {
	private calls: ToolCall[] = [];
	private _needsNewline = false; // true after a tool line (no trailing \n yet)
	private _linesChanged = 0;

	constructor(private options: ToolTrackerOptions = {}) {}

	private get _renderEnabled(): boolean {
		return typeof this.options.write === "function";
	}

	private write(text: string): void {
		if (this.options.write) this.options.write(text);
	}

	get count(): number {
		return this.calls.length;
	}

	/** Call before writing any text — ensures text starts on fresh line after a tool. */
	beforeText(): void {
		if (this._renderEnabled && this._needsNewline) {
			this.write("\n");
			this._needsNewline = false;
		}
	}

	/** Register a tool call and print it as its own line. */
	track(name: string, args: Record<string, unknown>): void {
		this.trackPreview(name, toolPreview(name, args), args);
	}

	trackPreview(
		name: string,
		preview: string,
		args: Record<string, unknown> = {},
	): void {
		const diffPreview = createToolDiffPreview(name, args);
		this.calls.push({ name, preview });
		this.options.onTool?.(name, preview);
		if (diffPreview) this.options.onToolDiff?.(diffPreview);

		// Estimate lines changed from file-writing tools
		if (name === "Edit" && args.new_string)
			this._linesChanged += String(args.new_string).split("\n").length;
		else if (name === "Write" && args.content)
			this._linesChanged += String(args.content).split("\n").length;

		if (this._renderEnabled) {
			const emoji = toolEmoji(name);
			const line = `\n  ${emoji} ${chalk.cyan(name)}  ${chalk.dim(preview)}`;
			this.write(line);
			this._needsNewline = true;
		}
	}

	/** Finalize display: flush pending newline, print collapsed summary. */
	finish(): void {
		if (this._renderEnabled && this._needsNewline) {
			this.write("\n");
			this._needsNewline = false;
		}
		if (this.calls.length === 0) return;

		const summary = `↳ ${this.calls.length} tool${this.calls.length !== 1 ? "s" : ""}`;
		this.options.onSummary?.(summary);

		if (!this._renderEnabled) return;

		const icons = this.calls.map((c) => toolEmoji(c.name)).join(" ");
		this.write(
			chalk.dim(
				`\n  ↳ ${this.calls.length} tool${this.calls.length !== 1 ? "s" : ""}  ${icons}\n`,
			),
		);
	}

	/** Return aggregated stats for session accumulation. */
	stats(): ToolTrackerStats {
		const toolCounts = new Map<string, number>();
		for (const c of this.calls) {
			toolCounts.set(c.name, (toolCounts.get(c.name) ?? 0) + 1);
		}
		return {
			count: this.calls.length,
			toolCounts,
			linesChanged: this._linesChanged,
		};
	}
}

// ─── Auth error detection ─────────────────────────────────────────────────────

function detectAuthError(stderr: string, provider: string): string | null {
	const s = stderr.toLowerCase();
	if (provider === "claude") {
		if (
			s.includes("not authenticated") ||
			s.includes("login") ||
			s.includes("auth")
		) {
			return `  Claude not authenticated. Run: ${chalk.cyan("claude auth login")}`;
		}
	}
	if (provider === "codex") {
		if (
			s.includes("api key") ||
			s.includes("openai_api_key") ||
			s.includes("unauthorized")
		) {
			return `  Set your API key: ${chalk.cyan("export OPENAI_API_KEY=sk-...")}`;
		}
	}
	if (provider === "kimi") {
		if (
			s.includes("api key") ||
			s.includes("moonshot") ||
			s.includes("unauthorized")
		) {
			return `  Set your API key: ${chalk.cyan("export MOONSHOT_API_KEY=...")}`;
		}
	}
	return null;
}

// ─── In-place emoji spinner ───────────────────────────────────────────────────
// Cycles through frames in-place with \r, no movement track.
const SPIN_FRAMES = ["🌻", "🌸", "🌺", "🌼", "🍯", "🌻"];

function startSpinner(label: string): () => void {
	if (!process.stdout.isTTY) return () => {};
	let i = 0;
	process.stdout.write(`  ${SPIN_FRAMES[0]} ${chalk.gray(label)}`);
	const t = setInterval(() => {
		// \x1b[2K erases the line, \x1b[G moves to column 1 (avoids OCRNL converting \r→\n)
		process.stdout.write(
			`\x1b[2K\x1b[G  ${SPIN_FRAMES[i++ % SPIN_FRAMES.length]} ${chalk.gray(label)}`,
		);
	}, 500);
	return () => {
		clearInterval(t);
		process.stdout.write("\x1b[2K\x1b[G");
	};
}

// ─── ChatSession ─────────────────────────────────────────────────────────────
//
// Prefers ACP session continuation instead of rebuilding prompts:
//   - ACP:    session_id persisted per provider when acp_base_url is configured
//   - Fallback: provider-native CLI sessions when ACP is not configured
//
// Providers own their native threads, but Bee also keeps a lightweight global
// transcript. When switching providers, Bee injects only the unseen transcript
// delta so the target provider can catch up instead of starting cold.

export interface SessionStats {
	durationMs: number;
	messages: number;
	totalTools: number;
	toolCounts: Map<string, number>;
	linesChanged: number;
}

export interface ChatRenderHooks {
	onThinkingStart?: (label: string) => void;
	onThinking?: (text: string) => void;
	onTool?: (name: string, preview: string) => void;
	onToolDiff?: (meta: ToolDiffMeta) => void;
	onToolSummary?: (summary: string) => void;
	onText?: (text: string) => void;
	onError?: (text: string) => void;
	/** Fired instead of onText when the response is a plan routing marker */
	onPlanIntent?: (goal: string) => void;
}

const PLAN_INTENT_PREFIX = `[If the following message is a software development task (build, fix, implement, create, add, migrate, refactor, debug, or similar — in ANY human language), respond ONLY with: <bee:plan goal="<concise English goal>"/>. Otherwise respond normally.]

`;
const PLAN_MARKER_START = "<bee:plan";
const PLAN_MARKER_REGEX = /^<bee:plan\s+goal="([^"]+)"\s*\/?>/;

export interface ChatOptions {
	/** Called with a message when the session starts working, null when done. */
	onStatusUpdate?: (message: string | null) => void;
	/** Project root path for session persistence. */
	projectPath?: string;
}

export interface InitSessionOptions {
	/** Resume a specific bee session id. */
	resumeSessionId?: string;
	/** Resume the newest session in current project when no explicit id is given. */
	resumeLatest?: boolean;
}

const HANDOFF_MAX_LINES = 120;
const HANDOFF_MAX_CHARS = 16_000;

function transcriptRoleLabel(type: BeeTranscriptLine["type"]): string {
	switch (type) {
		case "user":
			return "User";
		case "assistant":
			return "Assistant";
		case "tool":
			return "Tool";
		case "thinking":
			return "Thinking";
		case "error":
			return "Error";
	}
}

function renderHandoffLines(lines: BeeTranscriptLine[]): string {
	return lines
		.map((line) => {
			const text = stripAnsi(line.text).trimEnd();
			return `[${transcriptRoleLabel(line.type)}]\n${text}`;
		})
		.join("\n\n");
}

export function buildProviderHandoff(
	session: BeeSession | null,
	provider: string,
): string | null {
	if (!session || session.transcript.length === 0) return null;

	const latestSeq =
		typeof session.transcriptSeq === "number"
			? session.transcriptSeq
			: (session.transcript.at(-1)?.seq ?? 0);
	const syncedThrough = session.providers[provider]?.syncedThrough ?? 0;
	if (latestSeq <= syncedThrough) return null;

	const pendingLines = session.transcript.filter(
		(line) => line.seq > syncedThrough,
	);
	if (pendingLines.length === 0) return null;

	const retainedFromSeq = session.transcript[0]?.seq ?? latestSeq;
	const omittedByRetention = retainedFromSeq > syncedThrough + 1;

	let visibleLines = pendingLines.slice(-HANDOFF_MAX_LINES);
	let omittedByBudget = pendingLines.length - visibleLines.length;
	let transcriptText = renderHandoffLines(visibleLines);
	while (transcriptText.length > HANDOFF_MAX_CHARS && visibleLines.length > 1) {
		visibleLines = visibleLines.slice(1);
		omittedByBudget++;
		transcriptText = renderHandoffLines(visibleLines);
	}

	const notes: string[] = [];
	if (omittedByRetention) {
		notes.push(
			"Some earlier unseen context is not available because Bee only retains the recent transcript window.",
		);
	}
	if (omittedByBudget > 0) {
		notes.push(
			`Older unseen transcript lines were trimmed for brevity (${omittedByBudget} omitted).`,
		);
	}

	return [
		"You are continuing an existing Bee session after a provider switch.",
		"Review the transcript below as established context before answering the new user message.",
		...(notes.length > 0 ? [`Notes: ${notes.join(" ")}`] : []),
		"",
		"Transcript:",
		transcriptText,
	].join("\n");
}

export function buildProviderRequest(
	userMessage: string,
	provider: string,
	session: BeeSession | null,
): string {
	const handoff = buildProviderHandoff(session, provider);
	if (!handoff) return userMessage;
	return `${handoff}\n\nNew user message:\n${userMessage}`;
}

interface AcpTextContent {
	type?: string;
	text?: string;
}

interface AcpWrappedContent {
	type?: string;
	content?: AcpTextContent;
}

interface AcpPermissionOption {
	kind?: string;
	optionId?: string;
}

interface AcpSessionUpdate {
	sessionUpdate?: string;
	content?: AcpTextContent | AcpWrappedContent[];
	toolCallId?: string;
	title?: string;
}

function buildAcpSessionParams(cwd: string): {
	cwd: string;
	mcpServers: never[];
} {
	return {
		cwd,
		mcpServers: [],
	};
}

function isAcpTerminalStatus(status: AcpRunStatus["status"]): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "cancelled" ||
		status === "awaiting"
	);
}

function formatAcpError(error: AcpRunStatus["error"]): string | null {
	if (!error) return null;
	if (typeof error === "string") return error;
	return error.message ?? null;
}

function extractAcpOutputText(output: AcpMessage[] | undefined): string {
	if (!output?.length) return "";
	return output
		.filter((message) => message.role !== "user")
		.flatMap((message) => message.parts)
		.map((part) => part.content)
		.join("\n")
		.trim();
}

function pickAcpPermissionOptionId(
	options: AcpPermissionOption[],
): string | null {
	return (
		options.find((option) => option.kind === "allow_always")?.optionId ??
		options.find((option) => option.kind === "allow_once")?.optionId ??
		options[0]?.optionId ??
		null
	);
}

function extractAcpUpdateText(
	content?: AcpTextContent | AcpWrappedContent[],
): string {
	if (!content) return "";
	if (!Array.isArray(content)) {
		return content.type === "text" ? (content.text ?? "") : "";
	}
	return content
		.map((item) =>
			item.type === "content" && item.content?.type === "text"
				? (item.content.text ?? "")
				: "",
		)
		.join("");
}

function parseAcpToolTitle(title: string): { name: string; preview: string } {
	const [name, preview] = title.split(": ", 2);
	return {
		name: name || "tool",
		preview: preview ?? title,
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function extractSessionId(value: unknown): string | null {
	const record = asRecord(value);
	const sessionId = record?.sessionId;
	return typeof sessionId === "string" && sessionId.length > 0
		? sessionId
		: null;
}

function classifyInitialPlanMarker(buffer: string): {
	kind: "pending" | "plan" | "text";
	goal?: string;
} {
	const trimmed = buffer.trimStart();
	if (!trimmed) return { kind: "pending" };

	if (trimmed.length < PLAN_MARKER_START.length) {
		return PLAN_MARKER_START.startsWith(trimmed)
			? { kind: "pending" }
			: { kind: "text" };
	}

	if (!trimmed.startsWith(PLAN_MARKER_START)) {
		return { kind: "text" };
	}

	const match = trimmed.match(PLAN_MARKER_REGEX);
	if (match?.[1]) {
		return { kind: "plan", goal: match[1] };
	}

	return trimmed.includes(">") ? { kind: "text" } : { kind: "pending" };
}

export function buildAcpChatRequest(
	prompt: string,
	provider: string,
	config?: Pick<WorkspaceConfig, "acp_agent_names">,
	sessionId?: string | null,
): AcpRunRequest {
	return {
		agent_name: resolveAcpAgentName(provider, config),
		input: [
			{
				role: "user",
				parts: [{ content: prompt, content_type: "text/plain" }],
			},
		],
		...(sessionId ? { session_id: sessionId } : {}),
		mode: "async",
	};
}

export class ChatSession {
	private sessionStart = Date.now();
	private totalTools = 0;
	private toolCounts = new Map<string, number>();
	private linesChanged = 0;
	private _messageCount = 0;

	// ── Provider session IDs ─────────────────────────────────────────────────
	// With ACP these are ACP session_id values; without ACP they remain the
	// provider-native CLI session IDs used by the legacy fallback path.
	private _claudeSessionId: string | null = null;
	private _codexSessionId: string | null = null;
	private _kimiSessionId: string | null = null;
	private _acpClient: AcpClient | null = null;
	private _acpClientBaseUrl: string | null = null;

	// ── Persistent session (optional) ────────────────────────────────────────
	private _sessionManager: SessionManager | null = null;
	private _beeSession: BeeSession | null = null;

	constructor(
		private config: WorkspaceConfig,
		private opts: ChatOptions = {},
	) {
		if (opts.projectPath) {
			this._sessionManager = new SessionManager(opts.projectPath);
		}
	}

	get messageCount(): number {
		return this._messageCount;
	}

	/** Reset native session IDs — starts fresh conversations with all providers. */
	clearHistory(): void {
		this._claudeSessionId = null;
		this._codexSessionId = null;
		this._kimiSessionId = null;
		this._messageCount = 0;
		if (this._beeSession) {
			this._beeSession.messageCount = 0;
			this._beeSession.transcript = [];
			if (this._sessionManager) {
				void this._sessionManager.resetConversation(this._beeSession);
			}
		}
	}

	/** Get the current bee session (if persisted). */
	get beeSession(): BeeSession | null {
		return this._beeSession;
	}

	get transcript(): BeeTranscriptLine[] {
		return this._beeSession?.transcript ?? [];
	}

	async appendTranscript(
		lines: Array<Pick<BeeTranscriptLine, "type" | "text" | "meta">>,
	): Promise<void> {
		if (!this._sessionManager || !this._beeSession || lines.length === 0)
			return;
		const now = new Date().toISOString();
		const stamped: BeeTranscriptLine[] = lines.map((line) => ({
			type: line.type,
			text: line.text,
			...(line.meta ? { meta: line.meta } : {}),
			at: now,
			seq: 0,
		}));
		await this._sessionManager.appendTranscript(this._beeSession, stamped);
		await this._sessionManager.markProviderSynced(
			this._beeSession,
			this.config.provider,
		);
	}

	/** Switch active provider for both runtime config and persisted bee session. */
	async switchProvider(to: string): Promise<void> {
		this.config.provider = to;
		if (this._sessionManager && this._beeSession) {
			await this._sessionManager.switchProvider(this._beeSession, to);
			return;
		}
		if (this._beeSession) {
			this._beeSession.activeProvider = to;
		}
	}

	/** Initialize or resume a persistent session. Call once after construction. */
	async initSession(opts: InitSessionOptions = {}): Promise<BeeSession> {
		const { resumeSessionId, resumeLatest = false } = opts;
		if (!this._sessionManager) {
			this._sessionManager = new SessionManager(
				this.opts.projectPath ?? process.cwd(),
			);
		}
		let existing: BeeSession | null = null;
		if (resumeSessionId) {
			existing = await this._sessionManager.load(resumeSessionId);
			if (!existing) {
				const prefixMatches = (await this._sessionManager.list()).filter(
					(session) => session.id.startsWith(resumeSessionId),
				);

				if (prefixMatches.length === 1) {
					existing = prefixMatches[0] ?? null;
				} else if (prefixMatches.length > 1) {
					const sample = prefixMatches
						.slice(0, 5)
						.map((session) => session.id.slice(0, 12))
						.join(", ");
					throw new Error(
						`Ambiguous session prefix "${resumeSessionId}" (${prefixMatches.length} matches: ${sample}${prefixMatches.length > 5 ? ", ..." : ""}). Use a longer id.`,
					);
				} else {
					throw new Error(
						`Session not found in current project: ${resumeSessionId}`,
					);
				}
			}
		} else if (resumeLatest) {
			existing = await this._sessionManager.loadLatest();
		}

		if (existing) {
			this._beeSession = existing;
			// Restore native session IDs from persisted bindings
			for (const [name, binding] of Object.entries(existing.providers)) {
				if (binding.nativeId) {
					if (name === "claude") this._claudeSessionId = binding.nativeId;
					else if (name === "codex") this._codexSessionId = binding.nativeId;
					else if (name === "kimi") this._kimiSessionId = binding.nativeId;
				}
			}
			this._messageCount = existing.messageCount;
			if (existing.activeProvider) {
				this.config.provider = existing.activeProvider;
			}
			return existing;
		}
		// Create new session
		this._beeSession = await this._sessionManager.create(this.config.provider);
		return this._beeSession;
	}

	private shouldUseLocalAcp(provider = this.config.provider): boolean {
		return provider === "claude" || provider === "codex" || provider === "kimi";
	}

	private shouldUseAcp(provider = this.config.provider): boolean {
		return this.shouldUseLocalAcp(provider) || Boolean(this.config.acp_base_url);
	}

	private getHttpAcpClient(): AcpClient {
		const baseUrl = this.config.acp_base_url?.trim();
		if (!baseUrl) {
			throw new Error(
				"ACP is not configured. Set acp_base_url in .bee/config.json.",
			);
		}
		if (!this._acpClient || this._acpClientBaseUrl !== baseUrl) {
			this._acpClient = new AcpClient(baseUrl, this.config.timeout_ms);
			this._acpClientBaseUrl = baseUrl;
		}
		return this._acpClient;
	}

	private getProviderSessionId(provider: string): string | null {
		switch (provider) {
			case "claude":
				return this._claudeSessionId;
			case "codex":
				return this._codexSessionId;
			case "kimi":
				return this._kimiSessionId;
			default:
				return this._beeSession?.providers[provider]?.nativeId ?? null;
		}
	}

	private async bindProviderSessionId(
		provider: string,
		sessionId: string,
	): Promise<void> {
		if (!sessionId) return;
		if (provider === "claude") this._claudeSessionId = sessionId;
		else if (provider === "codex") this._codexSessionId = sessionId;
		else if (provider === "kimi") this._kimiSessionId = sessionId;

		if (this._sessionManager && this._beeSession) {
			await this._sessionManager.bindNativeId(
				this._beeSession,
				provider,
				sessionId,
			);
		}
	}

	private accumulateStats(s: ToolTrackerStats): void {
		this.totalTools += s.count;
		this.linesChanged += s.linesChanged;
		for (const [name, count] of s.toolCounts) {
			this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + count);
		}
	}

	getSessionStats(): SessionStats {
		return {
			durationMs: Date.now() - this.sessionStart,
			messages: this._messageCount,
			totalTools: this.totalTools,
			toolCounts: this.toolCounts,
			linesChanged: this.linesChanged,
		};
	}

	/**
	 * Send a user message to the configured provider and stream the response.
	 * Uses ACP session continuation when configured, otherwise falls back to
	 * provider-native CLI continuation without prompt rebuilding.
	 */
	async send(userMessage: string, hooks?: ChatRenderHooks): Promise<void> {
		const eventMode = Boolean(hooks);
		this._messageCount++;
		this.opts.onStatusUpdate?.("thinking…");
		if (!eventMode) {
			console.log(); // blank line before response
		} else {
			hooks?.onThinkingStart?.("thinking…");
		}

		try {
			if (this.shouldUseAcp()) {
				await this.sendViaAcp(this.config.provider, userMessage, hooks);
			} else {
				switch (this.config.provider) {
					case "claude":
						await this.sendClaude(userMessage, hooks);
						break;
					case "codex":
						await this.sendCodex(userMessage, hooks);
						break;
					default:
						await this.sendClaude(userMessage, hooks);
				}
			}
		} catch (err) {
			const errorText = `Error: ${String(err)}`;
			if (eventMode) {
				hooks?.onError?.(errorText);
			} else {
				console.error(chalk.red(`  ${errorText}\n`));
			}
			this._messageCount--;
			return;
		} finally {
			this.opts.onStatusUpdate?.(null);
		}

		// Persist session state (non-blocking)
		if (this._sessionManager && this._beeSession) {
			void this._sessionManager.recordMessage(this._beeSession);
		}

		if (!eventMode) {
			console.log(); // blank line after response
		}
	}

	private async sendViaAcp(
		provider: string,
		userMessage: string,
		hooks?: ChatRenderHooks,
	): Promise<string> {
		if (this.shouldUseLocalAcp(provider)) {
			return this.sendViaLocalAcp(provider, userMessage, hooks);
		}
		return this.sendViaHttpAcp(provider, userMessage, hooks);
	}

	private async sendViaLocalAcp(
		provider: string,
		userMessage: string,
		hooks?: ChatRenderHooks,
	): Promise<string> {
		const eventMode = Boolean(hooks);
		const stopSpinner = eventMode ? () => {} : startSpinner("thinking…");
		let spinnerStopped = false;
		let client: StdioAcpClient | null = null;
		const tracker = new ToolTracker({
			write: eventMode ? undefined : (text) => process.stdout.write(text),
			onTool: (name, preview) => hooks?.onTool?.(name, preview),
			onToolDiff: (meta) => hooks?.onToolDiff?.(meta),
			onSummary: (summary) => hooks?.onToolSummary?.(summary),
		});
		const cwd = this.opts.projectPath ?? process.cwd();
		let fullText = "";
		let initialTextState: "pending" | "plan" | "text" = "pending";
		let initialTextBuffer = "";
		let planGoal: string | null = null;
		const requestMessage = buildProviderRequest(
			userMessage,
			provider,
			this._beeSession,
		);

		const stopOnce = () => {
			if (!spinnerStopped) {
				stopSpinner();
				spinnerStopped = true;
			}
		};

		const emitText = (text: string) => {
			if (!text) return;
			tracker.beforeText();
			if (eventMode) hooks?.onText?.(text);
			else process.stdout.write(text);
		};

		try {
			client = new StdioAcpClient(
				getAcpCommandConfig(provider, this.config),
				{
					cwd,
					onNotification: (message: AcpJsonRpcNotification) => {
						if (message.method !== "session/update") return;
						const params = asRecord(message.params);
						const update = asRecord(params?.update) as AcpSessionUpdate | null;
						if (!update?.sessionUpdate) return;

						switch (update.sessionUpdate) {
							case "agent_message_chunk": {
								const text = extractAcpUpdateText(update.content);
								if (!text) return;
								stopOnce();
								fullText += text;
								if (initialTextState === "plan") {
									return;
								}

								if (initialTextState === "text") {
									emitText(text);
									return;
								}

								initialTextBuffer += text;
								const classification = classifyInitialPlanMarker(
									initialTextBuffer,
								);
								if (classification.kind === "pending") {
									return;
								}

								if (classification.kind === "plan") {
									initialTextState = "plan";
									planGoal = classification.goal ?? null;
									return;
								}

								initialTextState = "text";
								emitText(initialTextBuffer);
								initialTextBuffer = "";
								return;
							}
							case "agent_thought_chunk": {
								const excerpt = extractAcpUpdateText(update.content).trim();
								if (!excerpt) return;
								stopOnce();
								if (eventMode) {
									hooks?.onThinking?.(excerpt);
								} else {
									tracker.beforeText();
									process.stdout.write(
										chalk.dim(`\n  💭  ${excerpt}\n`),
									);
								}
								return;
							}
							case "tool_call": {
								stopOnce();
								const { name, preview } = parseAcpToolTitle(
									update.title ?? "tool",
								);
								tracker.trackPreview(name, preview);
								return;
							}
						}
					},
					onRequest: (message: AcpJsonRpcRequest) => {
						if (message.method !== "session/request_permission") {
							throw new Error(`Unsupported ACP request: ${message.method}`);
						}

						const params = asRecord(message.params);
						const rawOptions = Array.isArray(params?.options)
							? params.options
							: [];
						const options = rawOptions
							.map((option) => asRecord(option))
							.filter((option): option is Record<string, unknown> => option !== null)
							.map((option) => ({
								kind:
									typeof option.kind === "string" ? option.kind : undefined,
								optionId:
									typeof option.optionId === "string"
										? option.optionId
										: undefined,
							}));
						const optionId = pickAcpPermissionOptionId(options);
						return optionId
							? { outcome: { outcome: "selected", optionId } }
							: { outcome: { outcome: "cancelled" } };
					},
				},
			);
			await client.connect();

			const previousSessionId = this.getProviderSessionId(provider);
			const sessionResult = await client.request(
				previousSessionId ? "session/load" : "session/new",
				previousSessionId
					? {
							sessionId: previousSessionId,
							...buildAcpSessionParams(cwd),
						}
					: buildAcpSessionParams(cwd),
			);
			const sessionId =
				extractSessionId(sessionResult) ?? previousSessionId ?? null;
			if (!sessionId) {
				throw new Error(`ACP session did not return a session id for "${provider}"`);
			}
			await this.bindProviderSessionId(provider, sessionId);

			await client.request("session/prompt", {
				sessionId,
				prompt: [{ type: "text", text: PLAN_INTENT_PREFIX + requestMessage }],
			});
			stopOnce();

			if (initialTextState === "pending" && initialTextBuffer) {
				initialTextState = "text";
				emitText(initialTextBuffer);
				initialTextBuffer = "";
			}

			if (planGoal) {
				if (eventMode) hooks?.onPlanIntent?.(planGoal);
				else process.stdout.write(fullText);
				return fullText.trim();
			}

			return fullText.trim();
		} finally {
			await client?.close().catch(() => undefined);
			stopOnce();
			tracker.finish();
			this.accumulateStats(tracker.stats());
		}
	}

	private async sendViaHttpAcp(
		provider: string,
		userMessage: string,
		hooks?: ChatRenderHooks,
	): Promise<string> {
		const eventMode = Boolean(hooks);
		const stopSpinner = eventMode ? () => {} : startSpinner("thinking…");
		let spinnerStopped = false;
		const requestMessage = buildProviderRequest(
			userMessage,
			provider,
			this._beeSession,
		);
		const request = buildAcpChatRequest(
			PLAN_INTENT_PREFIX + requestMessage,
			provider,
			this.config,
			this.getProviderSessionId(provider),
		);

		const stopOnce = () => {
			if (!spinnerStopped) {
				stopSpinner();
				spinnerStopped = true;
			}
		};

		try {
			const client = this.getHttpAcpClient();
			const run = await client.createRun(request);
			if (run.session_id) {
				await this.bindProviderSessionId(provider, run.session_id);
			}

			const final = isAcpTerminalStatus(run.status)
				? run
				: await client.waitForCompletion(run.run_id, 1000);
			stopOnce();

			const sessionId = final.session_id ?? run.session_id;
			if (sessionId) {
				await this.bindProviderSessionId(provider, sessionId);
			}

			const errorText = formatAcpError(final.error);
			if (final.status === "failed") {
				throw new Error(
					errorText ?? `ACP run failed for provider "${provider}"`,
				);
			}
			if (final.status === "cancelled") {
				throw new Error(
					errorText ?? `ACP run was cancelled for provider "${provider}"`,
				);
			}
			if (final.status === "awaiting") {
				throw new Error(
					errorText ??
						`ACP run is awaiting external input for provider "${provider}"`,
				);
			}

			const fullText = extractAcpOutputText(final.output);
			const planMatch = fullText.match(/^<bee:plan\s+goal="([^"]+)"\s*\/?>/);
			if (planMatch) {
				const goal = planMatch[1];
				if (eventMode && goal) hooks?.onPlanIntent?.(goal);
				else process.stdout.write(fullText);
				return fullText;
			}

			if (fullText) {
				if (eventMode) hooks?.onText?.(fullText);
				else process.stdout.write(fullText);
			}
			return fullText;
		} finally {
			stopOnce();
		}
	}

	// ── Claude ─────────────────────────────────────────────────────────────────
	// Uses --session-id to maintain conversation natively.
	// First call: generates a UUID for the session.
	// Subsequent calls: --resume <session-id> continues the conversation.

	private async sendClaude(
		userMessage: string,
		hooks?: ChatRenderHooks,
	): Promise<string> {
		const model = this.config.model ?? "claude-sonnet-4-6";
		const requestMessage = buildProviderRequest(
			userMessage,
			"claude",
			this._beeSession,
		);

		// Allocate a native session ID on first call
		const isFirstMessage = this._claudeSessionId === null;
		if (isFirstMessage) {
			this._claudeSessionId = crypto.randomUUID();
		}
		const claudeSessionId = this._claudeSessionId;
		if (!claudeSessionId) {
			throw new Error("Claude session id was not initialized");
		}

		const eventMode = Boolean(hooks);
		const stopSpinner = eventMode ? () => {} : startSpinner("thinking…");
		let spinnerStopped = false;
		const tracker = new ToolTracker({
			write: eventMode ? undefined : (text) => process.stdout.write(text),
			onTool: (name, preview) => hooks?.onTool?.(name, preview),
			onToolDiff: (meta) => hooks?.onToolDiff?.(meta),
			onSummary: (summary) => hooks?.onToolSummary?.(summary),
		});

		// Build args: first message uses --session-id, subsequent use --resume
		const args = [
			"claude",
			"--dangerously-skip-permissions",
			"--model",
			model,
			"--output-format",
			"stream-json",
			"--verbose",
		];

		if (isFirstMessage) {
			// First message: establish a new session with this ID
			args.push("--session-id", claudeSessionId);
		} else {
			// Subsequent messages: resume the existing session
			args.push("--resume", claudeSessionId);
		}

		// Prompt goes via stdin (edit mode); prepend classifier so LLM can route to plan flow
		const proc = Bun.spawn(args, {
			stdin: new Blob([PLAN_INTENT_PREFIX + requestMessage]),
			stdout: "pipe",
			stderr: "pipe",
		});

		// Persist native ID to bee session
		if (this._sessionManager && this._beeSession && isFirstMessage) {
			void this._sessionManager.bindNativeId(
				this._beeSession,
				"claude",
				claudeSessionId,
			);
		}

		// Drain stderr concurrently to prevent buffer deadlock
		const stderrProm = new Response(proc.stderr).text().catch(() => "");

		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let fullText = "";
		let buf = "";

		function stopOnce() {
			if (!spinnerStopped) {
				stopSpinner();
				spinnerStopped = true;
			}
		}

		// Plan-intent detection: if LLM responds with <bee:plan goal="..."/>, suppress
		// onText and fire onPlanIntent instead — detected on first text chunk.
		let planMarkerDetected = false;
		let firstTextSeen = false;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });

				// Process every complete newline-delimited JSON line
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let ev: {
						type?: string;
						session_id?: string;
						message?: { content?: ContentBlock[] };
						result?: string;
						name?: string;
						input?: Record<string, unknown>;
					};
					try {
						ev = JSON.parse(trimmed);
					} catch {
						continue;
					}

					if (ev.type === "system") {
						// Claude emits session_id in the system init event
						if (ev.session_id && !this._claudeSessionId) {
							this._claudeSessionId = ev.session_id;
						}
						continue;
					}
					stopOnce();

					if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
						for (const block of ev.message.content) {
							if (block.type === "text" && block.text) {
								fullText += block.text;
								if (!firstTextSeen) {
									firstTextSeen = true;
									if (fullText.trimStart().startsWith("<bee:plan")) {
										planMarkerDetected = true;
									}
								}
								if (planMarkerDetected) continue;
								tracker.beforeText();
								if (eventMode) {
									hooks?.onText?.(block.text);
								} else {
									process.stdout.write(block.text);
								}
							} else if (block.type === "tool_use") {
								tracker.track(block.name ?? "", block.input ?? {});
							} else if (block.type === "thinking") {
								const excerpt = (block.thinking ?? "").trim().slice(0, 160);
								if (!excerpt) continue;
								if (eventMode) {
									hooks?.onThinking?.(excerpt);
								} else {
									tracker.beforeText();
									process.stdout.write(
										chalk.dim(
											`\n  💭  ${excerpt}${excerpt.length === 160 ? "…" : ""}\n`,
										),
									);
								}
							}
						}
					} else if (ev.type === "tool_use") {
						// Top-level tool_use event (emitted between assistant turns)
						tracker.track(ev.name ?? "", ev.input ?? {});
					} else if (ev.type === "result" && ev.result && !fullText.trim()) {
						tracker.beforeText();
						if (eventMode) {
							hooks?.onText?.(ev.result);
						} else {
							process.stdout.write(ev.result);
						}
						fullText = ev.result;
					}
				}
			}
		} finally {
			reader.releaseLock();
			stopOnce();
			tracker.finish();
			this.accumulateStats(tracker.stats());
		}

		await proc.exited;
		const stderrText = await stderrProm;

		const authErr = detectAuthError(stderrText, "claude");
		if (authErr) throw new Error(authErr);
		if (proc.exitCode !== 0 && stderrText.trim() && !fullText.trim()) {
			throw new Error(stderrText.trim());
		}

		if (planMarkerDetected && eventMode) {
			const match = fullText.trim().match(/^<bee:plan\s+goal="([^"]+)"\s*\/?>/);
			const goal = match?.[1];
			if (goal) hooks?.onPlanIntent?.(goal);
		}

		return fullText.trim();
	}

	// ── Codex ──────────────────────────────────────────────────────────────────
	// Uses `codex exec --json` for non-interactive execution.
	// Session continuity via `codex exec resume <thread_id>`.
	//
	// JSONL event format (from codex exec --json):
	//   {"type":"thread.started","thread_id":"<uuid>"}
	//   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
	//   {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N}}

	private async sendCodex(
		userMessage: string,
		hooks?: ChatRenderHooks,
	): Promise<string> {
		const eventMode = Boolean(hooks);
		const stopSpinner = eventMode ? () => {} : startSpinner("thinking…");
		const requestMessage = buildProviderRequest(
			userMessage,
			"codex",
			this._beeSession,
		);

		// Build args: codex exec [resume <thread_id>] --json --dangerously-bypass-approvals-and-sandbox <prompt>
		let args: string[];
		if (this._codexSessionId) {
			args = [
				"codex",
				"exec",
				"resume",
				this._codexSessionId,
				"--json",
				"--dangerously-bypass-approvals-and-sandbox",
				requestMessage,
			];
		} else {
			args = [
				"codex",
				"exec",
				"--json",
				"--dangerously-bypass-approvals-and-sandbox",
				requestMessage,
			];
		}

		const proc = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
		});

		// Drain stderr concurrently (codex logs warnings there)
		const stderrProm = new Response(proc.stderr).text().catch(() => "");

		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		let fullText = "";
		let spinnerStopped = false;

		function stopOnce() {
			if (!spinnerStopped) {
				stopSpinner();
				spinnerStopped = true;
			}
		}

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });

				const lines = buf.split("\n");
				buf = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let ev: {
						type?: string;
						thread_id?: string;
						item?: { type?: string; text?: string };
						usage?: { input_tokens?: number; output_tokens?: number };
					};
					try {
						ev = JSON.parse(trimmed);
					} catch {
						continue;
					}

					if (
						ev.type === "thread.started" &&
						ev.thread_id &&
						!this._codexSessionId
					) {
						this._codexSessionId = ev.thread_id;
						if (this._sessionManager && this._beeSession) {
							void this._sessionManager.bindNativeId(
								this._beeSession,
								"codex",
								this._codexSessionId,
							);
						}
					} else if (
						ev.type === "item.completed" &&
						ev.item?.type === "agent_message" &&
						ev.item.text
					) {
						stopOnce();
						const chunk = ev.item.text;
						fullText += chunk;
						if (eventMode) hooks?.onText?.(chunk);
						else process.stdout.write(chunk);
					} else if (ev.type === "turn.completed") {
						stopOnce();
					}
				}
			}
		} finally {
			reader.releaseLock();
			stopOnce();
		}

		await proc.exited;
		const stderrText = await stderrProm;

		const authErr = detectAuthError(stderrText, "codex");
		if (authErr) throw new Error(authErr);
		// Only treat as error if we got no output AND exit code is non-zero
		if (proc.exitCode !== 0 && !fullText.trim()) {
			// Filter out codex's internal log lines (e.g. ERROR codex_core::...)
			const stderrClean = stderrText
				.split("\n")
				.filter((l) => !l.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/))
				.join("\n")
				.trim();
			if (stderrClean) throw new Error(stderrClean);
		}

		return fullText.trim();
	}
}
