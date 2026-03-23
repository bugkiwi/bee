/**
 * Root Ink component — natural flow layout.
 *
 * Content flows top-to-bottom like a normal terminal:
 *   Banner
 *   status lines
 *   🐝 › [user input]         ← input follows content
 *   ── after submit ──
 *   › user message (dimmed)   ← becomes part of history
 *   🐝 thinking…              ← inline spinner
 *   AI response lines
 *   🐝 › [next input]         ← input moves down
 */

import {
	Box,
	Text,
	renderToString,
	useApp,
	useFocusManager,
	useInput,
	useStdin,
	useStdout,
} from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanTaskTree } from "../../components/PlanTaskTree.tsx";
import type { WorkspaceConfig } from "../../types/config.ts";
import { type Plan, PlanStatus, type PlanTask } from "../../types/plan.ts";
import { summarizeToolDiff } from "../../utils/diff-preview.ts";
import { stripAnsi } from "../../utils/strip-ansi.ts";
import type { ChatRenderHooks, ChatSession } from "../chat.ts";
import { SLASH_COMMANDS, resolveCommand } from "../commands.ts";
import {
	clipboardImageSizeAsync,
	ensureScreenshotDir,
	saveClipboardImage,
} from "../screenshot.ts";
import { InputPanel } from "./InputPanel.tsx";
import { StatusBar, type StatusPhase } from "./StatusBar.tsx";
import { ThinkingCollapsibleLine } from "./ThinkingCollapsibleLine.tsx";
import { WelcomePanel } from "./WelcomePanel.tsx";
import { resolveClickAction } from "./click-behavior.ts";
import {
	CONTENT_LABEL_GAP,
	CONTENT_LABEL_WIDTH,
	extractHistoryFromTranscript,
	getCollapsibleMetaGroupType,
	getContentBodyWidth,
	getContentLineBlocks,
	getContentLineLabel,
	getContentLineText,
	getMetaSummaryLine,
	hasContentLineLeadingColumn,
	isGenericThinkingLine,
	rowsForBlock,
	summarizeMetaGroup,
	toInlineSummaryText,
} from "./content.ts";
import { renderMarkdown } from "./markdown.ts";
import { extractTerminalEvents } from "./terminal.ts";
import type {
	ContentLine,
	CommandResult,
	MouseClickEvent,
	MouseScrollEvent,
	ProviderPickerOptions,
	ProviderQuickOption,
	RenderItem,
	SlashQuickOption,
} from "./types.ts";
import {
	INPUT_FOCUS_ID,
	MAX_HISTORY_ENTRIES,
	WELCOME_PANEL_ROWS,
} from "./types.ts";
import { collectTaskDetailLines } from "../../components/PlanNode.tsx";

const MAX_CONTENT_LINES = 1200;
const MAX_PLAN_TASK_LOG_LINES = 200;
const MAX_CAPTURE_TAIL_CHARS = 8192;
const SCROLLBACK_STEP_LINES = 4;

export interface AppProps {
	viewportEpoch: number;
	config: WorkspaceConfig;
	chatSession: ChatSession;
	initialStatus: string[];
	initialTranscript?: Array<{
		type: "user" | "assistant" | "tool" | "thinking" | "error";
		text: string;
		meta?: ContentLine["meta"];
	}>;
	onCommand: (cmd: string, args: string[]) => Promise<CommandResult>;
	onProviderPickerRequest: () => Promise<ProviderPickerOptions>;
	onProviderSelected: (provider: string) => Promise<void>;
	onExit: () => string[]; // returns summary lines to display before exit
	activePlan?: Plan | null;
}

function normalizePlanTimestamp(value: string | Date): string {
	return typeof value === "string" ? value : value.toISOString();
}

function planTaskStatusFromStepStatus(status: string): PlanStatus {
	switch (status) {
		case "completed":
			return PlanStatus.completed;
		case "in_progress":
			return PlanStatus.running;
		case "failed":
			return PlanStatus.failed;
		case "skipped":
			return PlanStatus.paused;
	}

	return PlanStatus.pending;
}

function buildDisplayPlan(plan: Plan): Plan {
	if (plan.tasks.length > 0) return plan;

	const createdAt = normalizePlanTimestamp(plan.createdAt);
	const updatedAt = normalizePlanTimestamp(plan.updatedAt);

	return {
		...plan,
		tasks: (plan.steps ?? []).map((step) => ({
			id: step.id,
			title: step.description,
			description: step.description,
			status: planTaskStatusFromStepStatus(step.status),
			createdAt,
			updatedAt,
		})),
	};
}

function countInlinePlanPreviewRows(plan: Plan, terminalWidth: number): number {
	const width = Math.max(20, terminalWidth);

	function countTaskRows(task: PlanTask, depth: number): number {
		let rows = 1;
		const detailLines = collectTaskDetailLines(task);
		const visibleDetails =
			detailLines.length > 0
				? detailLines
				: depth > 0 && task.description
					? [task.description]
					: [];
		const detailWidth = Math.max(1, width - (8 + depth * 3));

		for (const detailLine of visibleDetails) {
			rows += rowsForBlock(detailLine, detailWidth);
		}

		for (const child of task.children ?? []) {
			rows += countTaskRows(child, depth + 1);
		}

		return rows;
	}

	if (plan.tasks.length === 0) return 3;
	return (
		2 +
		plan.tasks.reduce((total, task) => total + countTaskRows(task, 0), 0)
	);
}

function countRenderedContentLineRows(
	line: ContentLine,
	terminalWidth: number,
): number {
	const bodyWidth = getContentBodyWidth(
		terminalWidth,
		hasContentLineLeadingColumn(line),
	);
	let rows = 0;

	if (line.type === "assistant") {
		rows += rowsForBlock(renderMarkdown(line.text), bodyWidth);
	} else {
		for (const block of getContentLineBlocks(line)) {
			rows += rowsForBlock(block, bodyWidth);
		}
	}

	if (line.meta?.kind === "plan-preview") {
		rows += countInlinePlanPreviewRows(line.meta.plan, bodyWidth);
	}

	return rows;
}

export function capContentLines<T>(
	lines: T[],
	maxLines = MAX_CONTENT_LINES,
): T[] {
	if (lines.length <= maxLines) return lines;
	return lines.slice(-maxLines);
}

export function appendCappedLines<T>(
	existing: T[],
	additions: T[],
	maxLines: number,
): T[] {
	if (additions.length === 0) return existing;
	return capContentLines([...existing, ...additions], maxLines);
}

export interface CapturedOutputChunk {
	lines: string[];
	remainder: string;
}

export function extractCapturedOutputChunk(
	remainder: string,
	chunk: string,
): CapturedOutputChunk {
	const normalized = `${remainder}${chunk}`
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n");

	const segments = normalized.split("\n");
	const nextRemainder = segments.pop() ?? "";
	const lines = segments
		.map((line) => stripAnsi(line).trimEnd())
		.filter((line) => line.length > 0);

	return { lines, remainder: nextRemainder };
}

export function getInputPanelRows(
	providerOptionCount: number,
	slashOptionCount: number,
): number {
	const optionsRows =
		providerOptionCount > 0
			? 1 + providerOptionCount + 1
			: slashOptionCount > 0
				? 1 + slashOptionCount + 1
				: 0;

	return 1 + 1 + 1 + optionsRows + 1 + 1 + 1;
}

export function computeScrollbackWindow(
	totalLines: number,
	windowSize: number,
	scrollOffset: number,
): [number, number] {
	const visibleWindow = Math.max(1, windowSize);
	const maxOffset = Math.max(0, totalLines - visibleWindow);
	const clampedOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
	const end = Math.max(0, totalLines - clampedOffset);
	const start = Math.max(0, end - visibleWindow);
	return [start, end];
}

export function extractScrollbackSnapshotLines(snapshot: string): string[] {
	const normalized = stripAnsi(snapshot)
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n");
	const lines = normalized.split("\n").map((line) => line.trimEnd());
	while (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

function flattenPlanTasks(tasks: PlanTask[]): PlanTask[] {
	const flat: PlanTask[] = [];

	for (const task of tasks) {
		flat.push(task);
		if (task.children && task.children.length > 0) {
			flat.push(...flattenPlanTasks(task.children));
		}
	}

	return flat;
}

function getActiveDisplayTaskId(plan: Plan | null): string | null {
	if (!plan || plan.tasks.length === 0) return null;
	const flatTasks = flattenPlanTasks(plan.tasks);
	const running = flatTasks.find((task) => task.status === PlanStatus.running);
	if (running) return running.id;
	const nextUp = flatTasks.find(
		(task) =>
			task.status === PlanStatus.pending || task.status === PlanStatus.paused,
	);
	if (nextUp) return nextUp.id;
	return flatTasks.at(-1)?.id ?? null;
}

export function shouldRenderPlanFocusView(
	plan: Plan | null,
	isProcessing: boolean,
): boolean {
	return Boolean(plan) && isProcessing;
}

// ─── App Component ──────────────────────────────────────────────────────────

export function App({
	viewportEpoch,
	config,
	chatSession,
	initialStatus,
	initialTranscript = [],
	onCommand,
	onProviderPickerRequest,
	onProviderSelected,
	onExit,
	activePlan = null,
}: AppProps) {
	const { exit } = useApp();
	const { focus, focusNext, focusPrevious } = useFocusManager();
	const { stdin, isRawModeSupported } = useStdin();
	const { stdout, write: writeTerminal } = useStdout();
	void viewportEpoch;
	const mouseCaptureEnabled = process.env.BEE_ENABLE_MOUSE !== "0";
	const initialInputHistory = useMemo(
		() => extractHistoryFromTranscript(initialTranscript),
		[initialTranscript],
	);

	// ── State ──────────────────────────────────────────────────────────────────
	const [lines, setLines] = useState<ContentLine[]>(() => {
		const initial: ContentLine[] = [];
		for (const [i, line] of initialStatus.entries()) {
			initial.push({ id: `status-${i}`, text: line, type: "system" });
		}
		for (const [i, line] of initialTranscript.entries()) {
			if (line.type === "thinking" && isGenericThinkingLine(line.text))
				continue;
			initial.push({ id: `resume-${i}`, text: line.text, type: line.type });
			const lastInitial = initial.at(-1);
			if (line.meta && lastInitial) lastInitial.meta = line.meta;
		}
		return capContentLines(initial);
	});

	const lineSeq = useRef(0);
	const nextLineId = useCallback((prefix: string) => {
		lineSeq.current += 1;
		return `${prefix}-${lineSeq.current}`;
	}, []);

	const [input, setInput] = useState("");
	const [inputResetKey, setInputResetKey] = useState(0);
	const [imageHint, setImageHint] = useState(false);
	const pendingClipImageRef = useRef(false);
	const imageSeqRef = useRef(0);
	const imageMapRef = useRef(new Map<string, string>());
	const inputRef = useRef(input);
	const [isProcessing, setIsProcessing] = useState(false);
	const [isExiting, setIsExiting] = useState(false);
	const [activeProvider, setActiveProvider] = useState(config.provider);
	const [history, setHistory] = useState<string[]>(() => initialInputHistory);
	const [historyIdx, setHistoryIdx] = useState(-1);
	const [savedInput, setSavedInput] = useState("");
	const [providerPicker, setProviderPicker] =
		useState<ProviderPickerOptions | null>(null);
	const [providerPickerIndex, setProviderPickerIndex] = useState(0);
	const [inputFocused, setInputFocused] = useState(true);
	const [scrollbackOffset, setScrollbackOffset] = useState(0);
	const [focusedThinkingId, setFocusedThinkingId] = useState<string | null>(
		null,
	);
	const [slashQuickIndex, setSlashQuickIndex] = useState(0);
	const [slashQuickDismissed, setSlashQuickDismissed] = useState(false);
	const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [activeThinkingLabel, setActiveThinkingLabel] = useState<string | null>(
		null,
	);
	const [hasAssistantStream, setHasAssistantStream] = useState(false);
	const mouseRemainderRef = useRef("");
	const cursorRowRef = useRef<number | null>(null);
	const displayPlan = useMemo(
		() => (activePlan ? buildDisplayPlan(activePlan) : null),
		[activePlan],
	);
	const [planTaskLogs, setPlanTaskLogs] = useState<Record<string, string[]>>(
		{},
	);
	const activeDisplayTaskId = useMemo(
		() => getActiveDisplayTaskId(displayPlan),
		[displayPlan],
	);
	const showPlanFocusView = useMemo(
		() => shouldRenderPlanFocusView(displayPlan, isProcessing),
		[displayPlan, isProcessing],
	);
	const lastLineId = useMemo(() => lines.at(-1)?.id ?? null, [lines]);
	const processedPlanLineIdRef = useRef<string | null>(null);
	const activePlanIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!displayPlan) {
			activePlanIdRef.current = null;
			processedPlanLineIdRef.current = lastLineId;
			setPlanTaskLogs({});
			return;
		}

		if (activePlanIdRef.current !== displayPlan.id) {
			activePlanIdRef.current = displayPlan.id;
			processedPlanLineIdRef.current = lastLineId;
			const flatTasks = flattenPlanTasks(displayPlan.tasks);
			setPlanTaskLogs(
				Object.fromEntries(flatTasks.map((task) => [task.id, []])),
			);
			return;
		}

		setPlanTaskLogs((prev) =>
			Object.fromEntries(
				flattenPlanTasks(displayPlan.tasks).map((task) => [
					task.id,
					prev[task.id] ?? [],
				]),
			),
		);
	}, [displayPlan, lastLineId]);

	useEffect(() => {
		if (!displayPlan || !activeDisplayTaskId) {
			processedPlanLineIdRef.current = lastLineId;
			return;
		}

		const lastProcessedId = processedPlanLineIdRef.current;
		const startIndex = lastProcessedId
			? lines.findIndex((line) => line.id === lastProcessedId) + 1
			: 0;
		const nextLines = startIndex > 0 ? lines.slice(startIndex) : lines;
		processedPlanLineIdRef.current = lines.at(-1)?.id ?? lastProcessedId;

		const appended = nextLines
			.filter(
				(line) =>
					line.type === "assistant" ||
					line.type === "thinking" ||
					line.type === "tool" ||
					line.type === "error",
			)
			.map((line) => stripAnsi(line.text).trim())
			.filter((line) => line.length > 0);

		if (appended.length === 0) return;

		setPlanTaskLogs((prev) => ({
			...prev,
			[activeDisplayTaskId]: appendCappedLines(
				prev[activeDisplayTaskId] ?? [],
				appended,
				MAX_PLAN_TASK_LOG_LINES,
			),
		}));
	}, [activeDisplayTaskId, displayPlan, lastLineId, lines]);

	const renderItems = useMemo<RenderItem[]>(() => {
		const items: RenderItem[] = [];
		for (let i = 0; i < lines.length; ) {
			const line = lines[i];
			if (!line) {
				i++;
				continue;
			}
			const groupType = getCollapsibleMetaGroupType(line);
			if (groupType) {
				const grouped: ContentLine[] = [line];
				let j = i + 1;
				while (j < lines.length) {
					const next = lines[j];
					if (!next) break;
					if (getCollapsibleMetaGroupType(next) !== groupType) break;
					grouped.push(next);
					j++;
				}
				items.push({
					kind: "meta-group",
					id: `meta-group-${line.id}`,
					groupType,
					lines: grouped,
				});
				i = j;
				continue;
			}
			items.push({ kind: "line", line });
			i += 1;
		}
		return items;
	}, [lines]);
	const thinkingGroupIds = useMemo(
		() =>
			renderItems
				.filter((item) => item.kind === "meta-group")
				.map((item) => item.id),
		[renderItems],
	);
	const streamingMetaGroupId = useMemo(() => {
		if (!isProcessing || hasAssistantStream) return null;
		const lastItem = renderItems[renderItems.length - 1];
		if (!lastItem || lastItem.kind !== "meta-group") return null;
		return lastItem.id;
	}, [hasAssistantStream, isProcessing, renderItems]);

	const globalStatus = useMemo((): {
		phase: StatusPhase;
		label: string;
	} | null => {
		if (!isProcessing) return null;
		if (hasAssistantStream) return { phase: "responding", label: "" };
		if (activeThinkingLabel)
			return {
				phase: "thinking",
				label: toInlineSummaryText(activeThinkingLabel),
			};
		if (streamingMetaGroupId) {
			const group = renderItems.find(
				(i) => i.kind === "meta-group" && i.id === streamingMetaGroupId,
			);
			if (group?.kind === "meta-group") {
				return {
					phase: "tool",
					label: summarizeMetaGroup(group.lines).summary,
				};
			}
		}
		return { phase: "thinking", label: "" };
	}, [
		isProcessing,
		hasAssistantStream,
		activeThinkingLabel,
		streamingMetaGroupId,
		renderItems,
	]);

	// ── Helpers ────────────────────────────────────────────────────────────────

	const addLine = useCallback(
		(
			text: string,
			type: ContentLine["type"],
			meta?: ContentLine["meta"],
			isFirstAssistantInTurn?: boolean,
		) => {
			setLines((prev) =>
				appendCappedLines(
					prev,
					[
						{
							id: nextLineId(type),
							text,
							type,
							...(meta ? { meta } : {}),
							...(isFirstAssistantInTurn
								? { isFirstAssistantInTurn: true }
								: {}),
						},
					],
					MAX_CONTENT_LINES,
				),
			);
		},
		[nextLineId],
	);

	const addLines = useCallback(
		(
			texts: string[],
			type: ContentLine["type"],
			meta?: ContentLine["meta"],
		) => {
			setLines((prev) =>
				appendCappedLines(
					prev,
					texts.map((text) => ({
						id: nextLineId(type),
						text,
						type,
						...(meta ? { meta } : {}),
					})),
					MAX_CONTENT_LINES,
				),
			);
		},
		[nextLineId],
	);

	const updateLineById = useCallback((id: string, text: string) => {
		setLines((prev) =>
			prev.map((line) => (line.id === id ? { ...line, text } : line)),
		);
	}, []);

	const replaceInput = useCallback((next: string) => {
		setInput(next);
		setInputResetKey((prev) => prev + 1);
		setSlashQuickDismissed(false);
		setSlashQuickIndex(0);
	}, []);

	const handleInputChange = useCallback(
		(next: string) => {
			if (scrollbackOffset > 0) {
				setScrollbackOffset(0);
			}
			setInput(next);
			setSlashQuickDismissed(false);
			setSlashQuickIndex(0);
		},
		[scrollbackOffset],
	);

	useEffect(() => {
		inputRef.current = input;
	}, [input]);

	const handleClipboardPaste = useCallback(() => {
		imageSeqRef.current++;
		const placeholder = `[Image #${imageSeqRef.current}]`;
		pendingClipImageRef.current = false;
		setImageHint(false);
		replaceInput(inputRef.current + placeholder);
		void saveClipboardImage().then((filePath) => {
			if (filePath) imageMapRef.current.set(placeholder, filePath);
		});
	}, [replaceInput]);
	const handleClipboardPasteRef = useRef(handleClipboardPaste);
	useEffect(() => {
		handleClipboardPasteRef.current = handleClipboardPaste;
	}, [handleClipboardPaste]);

	const focusInput = useCallback(() => {
		setTimeout(() => {
			focus(INPUT_FOCUS_ID);
			if (mouseCaptureEnabled) {
				writeTerminal("\u001b[6n");
			}
		}, 0);
	}, [focus, mouseCaptureEnabled, writeTerminal]);

	const toggleThinkingGroup = useCallback((groupId: string) => {
		setExpandedThinkingIds((prev) => {
			const next = new Set(prev);
			if (next.has(groupId)) next.delete(groupId);
			else next.add(groupId);
			return next;
		});
	}, []);

	useEffect(() => {
		setExpandedThinkingIds((prev) => {
			const next = new Set<string>();
			for (const id of thinkingGroupIds) {
				if (prev.has(id)) next.add(id);
			}
			if (next.size === prev.size) {
				let same = true;
				for (const id of next) {
					if (!prev.has(id)) {
						same = false;
						break;
					}
				}
				if (same) return prev;
			}
			return next;
		});
	}, [thinkingGroupIds]);

	useEffect(() => {
		if (!focusedThinkingId) return;
		if (thinkingGroupIds.includes(focusedThinkingId)) return;
		setFocusedThinkingId(null);
	}, [focusedThinkingId, thinkingGroupIds]);

	// ── Graceful exit: show summary then quit ──────────────────────────────────

	const doExit = useCallback(() => {
		const summaryLines = onExit();
		setIsExiting(true);
		setIsProcessing(true); // hide input
		setProviderPicker(null);
		setScrollbackOffset(0);
		setLines((prev) =>
			appendCappedLines(
				prev,
				summaryLines.map((text) => ({
					id: nextLineId("exit"),
					text,
					type: "system" as const,
				})),
				MAX_CONTENT_LINES,
			),
		);
	}, [nextLineId, onExit]);

	// After summary lines render, exit on next tick
	useEffect(() => {
		if (isExiting) {
			const timer = setTimeout(() => exit(), 50);
			return () => clearTimeout(timer);
		}
	}, [isExiting, exit]);

	// ── Status info ────────────────────────────────────────────────────────────

	const model = config.model ?? "default";
	const sid = chatSession.beeSession?.id;
	const sidStr = sid ? ` · ${sid.slice(0, 8)}` : "";
	const msgCount = chatSession.messageCount;
	const msgsStr =
		msgCount > 0 ? ` · ${msgCount} msg${msgCount !== 1 ? "s" : ""}` : "";
	const statusInfo = `${activeProvider} · ${model}${sidStr}${msgsStr}`;

	const slashQuickOptions = useMemo<SlashQuickOption[]>(() => {
		const current = input.trimStart();
		if (!current.startsWith("/")) return [];

		const firstSpace = current.indexOf(" ");
		if (firstSpace >= 0) return [];

		const query = current.slice(1);
		const matches = SLASH_COMMANDS.filter(
			(c) =>
				!query || c.name.startsWith(query) || (c.alias ?? "").startsWith(query),
		)
			.map((c, index) => {
				if (!query) return { c, score: 0, index };

				const nameExact = c.name === query;
				const aliasExact = c.alias === query;
				const namePrefix = c.name.startsWith(query);
				const aliasPrefix = (c.alias ?? "").startsWith(query);

				const score =
					(nameExact ? 400 : 0) +
					(aliasExact ? 300 : 0) +
					(namePrefix ? 100 : 0) +
					(aliasPrefix ? 80 : 0);

				return { c, score, index };
			})
			.sort((a, b) => {
				if (a.score !== b.score) return b.score - a.score;
				return a.index - b.index;
			})
			.map((item) => item.c);

		return matches.slice(0, 8).map((cmd) => {
			const usageTail = cmd.usage.replace(`/${cmd.name}`, "").trim();
			const requiresArgs = usageTail.length > 0 && !usageTail.startsWith("[");
			const commandText = `/${cmd.name}${requiresArgs ? " " : ""}`;
			return {
				key: cmd.name,
				command: `/${cmd.name}`,
				desc: cmd.desc,
				commandText,
				requiresArgs,
			};
		});
	}, [input]);

	const slashQuickOptionsVisible =
		!isProcessing &&
		!isExiting &&
		!providerPicker &&
		!slashQuickDismissed &&
		slashQuickOptions.length > 0;

	const providerQuickOptions = useMemo<ProviderQuickOption[]>(() => {
		if (!providerPicker) return [];
		return providerPicker.options.map((provider) => ({
			key: provider,
			label: provider,
			desc: provider === providerPicker.active ? "active" : "switch",
		}));
	}, [providerPicker]);

	const slashSuggestionHints = slashQuickOptions.map((opt) => opt.commandText);
	const statusDivider = "─".repeat(
		Math.max(
			8,
			Math.min(
				96,
				Math.min(statusInfo.length + 12, (stdout.columns ?? 80) - 8),
			),
		),
	);
	const inputPanelRows = useMemo(
		() =>
			getInputPanelRows(
				providerPicker ? providerQuickOptions.length : 0,
				slashQuickOptionsVisible ? slashQuickOptions.length : 0,
			),
		[
			providerPicker,
			providerQuickOptions.length,
			slashQuickOptions.length,
			slashQuickOptionsVisible,
		],
	);
	const scrollbackViewportRows = useMemo(
		() =>
			Math.max(
				4,
				(stdout.rows ?? 24) -
					WELCOME_PANEL_ROWS -
					inputPanelRows -
					(globalStatus ? 1 : 0),
			),
		[globalStatus, inputPanelRows, stdout.rows],
	);

	const clickLayout = useMemo(() => {
		const termWidth = Math.max(20, stdout.columns ?? 80);
		const thinkingRanges: Array<{ id: string; start: number; end: number }> =
			[];
		let row = WELCOME_PANEL_ROWS + 1;

		for (const item of renderItems) {
			if (item.kind === "line") {
				row += countRenderedContentLineRows(item.line, termWidth);
				continue;
			}

			const lines = item.lines;
			const expanded = expandedThinkingIds.has(item.id);
			const bodyWidth = getContentBodyWidth(termWidth, true);
			const { summary, full, truncated, summarySource } =
				summarizeMetaGroup(lines);
			const isStreamingGroup = isProcessing && streamingMetaGroupId === item.id;

			let h = 0;
			h += rowsForBlock(
				getMetaSummaryLine(summary, expanded, isStreamingGroup),
				bodyWidth,
			);

			if (expanded) {
				h += 1;
				if (truncated) h += rowsForBlock(full, bodyWidth);
				for (const line of lines) {
					if (line.id === summarySource?.id) continue;
					for (const block of getContentLineBlocks(line)) {
						h += rowsForBlock(block, bodyWidth);
					}
				}
			}

			const start = row;
			const end = row + h - 1;
			thinkingRanges.push({ id: item.id, start, end });
			row = end + 1;
		}

		const contentRows = row - 1;
		const inputStart = contentRows + 1;
		const inputEnd = contentRows + inputPanelRows;
		const inputCursorRow = contentRows + 3;

		return {
			totalRows: inputEnd,
			inputStart,
			inputEnd,
			inputCursorRow,
			thinkingRanges,
		};
	}, [
		expandedThinkingIds,
		renderItems,
		inputPanelRows,
		stdout.columns,
		isProcessing,
		streamingMetaGroupId,
	]);

	const adjustScrollback = useCallback(
		(
			direction: MouseScrollEvent["direction"],
			step = SCROLLBACK_STEP_LINES,
		) => {
			setScrollbackOffset((prev) => {
				if (direction === "up") {
					return prev + step;
				}
				return Math.max(0, prev - step);
			});
		},
		[],
	);

	useEffect(() => {
		if (!slashQuickOptionsVisible) {
			setSlashQuickIndex(0);
			return;
		}
		setSlashQuickIndex(0);
	}, [slashQuickOptionsVisible]);

	// ── Streaming capture ─────────────────────────────────────────────────────

	const streamCapturedOutput = useCallback(
		async (
			fn: () => Promise<void>,
			type: ContentLine["type"] = "system",
		): Promise<void> => {
			let remainder = "";
			let queuedLines: string[] = [];
			let flushTimer: ReturnType<typeof setTimeout> | null = null;

			const flushQueued = () => {
				if (flushTimer) {
					clearTimeout(flushTimer);
					flushTimer = null;
				}
				if (queuedLines.length === 0) return;
				const next = queuedLines;
				queuedLines = [];
				addLines(next, type);
			};

			const queueChunk = (chunk: string) => {
				const parsed = extractCapturedOutputChunk(remainder, chunk);
				remainder =
					parsed.remainder.length > MAX_CAPTURE_TAIL_CHARS
						? parsed.remainder.slice(-MAX_CAPTURE_TAIL_CHARS)
						: parsed.remainder;
				if (parsed.lines.length === 0) return;
				queuedLines.push(...parsed.lines);
				if (queuedLines.length >= 20) {
					flushQueued();
					return;
				}
				if (!flushTimer) {
					flushTimer = setTimeout(flushQueued, 16);
				}
			};

			const origWrite = process.stdout.write.bind(process.stdout);
			(
				process.stdout as unknown as { write: typeof process.stdout.write }
			).write = ((chunk: unknown, ..._rest: unknown[]): boolean => {
				if (typeof chunk === "string") {
					queueChunk(chunk);
				} else if (Buffer.isBuffer(chunk)) {
					queueChunk(chunk.toString());
				}
				return true;
			}) as typeof process.stdout.write;

			const origLog = console.log;
			const origError = console.error;
			console.log = (...args: unknown[]) => {
				queueChunk(`${args.map(String).join(" ")}\n`);
			};
			console.error = (...args: unknown[]) => {
				queueChunk(`${args.map(String).join(" ")}\n`);
			};

			try {
				await fn();
			} finally {
				(
					process.stdout as unknown as { write: typeof process.stdout.write }
				).write = origWrite;
				console.log = origLog;
				console.error = origError;
				flushQueued();
				const tail = stripAnsi(remainder).trimEnd();
				if (tail.trim().length > 0) {
					addLines([tail], type);
				}
			}
		},
		[addLines],
	);

	const openProviderPicker = useCallback(async () => {
		setIsProcessing(true);
		setScrollbackOffset(0);
		const picker = await onProviderPickerRequest();
		if (picker.options.length === 0) {
			addLine("  No providers available.", "system");
			setIsProcessing(false);
			focusInput();
			return;
		}
		setProviderPickerIndex(Math.max(0, picker.options.indexOf(picker.active)));
		setProviderPicker(picker);
		setIsProcessing(false);
	}, [addLine, focusInput, onProviderPickerRequest]);

	const closeProviderPicker = useCallback(() => {
		setProviderPicker(null);
		setProviderPickerIndex(0);
		setScrollbackOffset(0);
		focusInput();
	}, [focusInput]);

	const submitProviderPicker = useCallback(
		async (index: number) => {
			if (!providerPicker) return;

			const chosen = providerPicker.options[index];
			setProviderPicker(null);
			setProviderPickerIndex(0);
			setScrollbackOffset(0);

			if (!chosen) {
				focusInput();
				return;
			}
			if (chosen === config.provider) {
				addLine(`  ${chosen} is already active.`, "system");
				focusInput();
				return;
			}

			setIsProcessing(true);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await streamCapturedOutput(async () => {
				await onProviderSelected(chosen);
			});

			setActiveProvider(config.provider);
			focusInput();
			setIsProcessing(false);
		},
		[
			addLine,
			config.provider,
			focusInput,
			onProviderSelected,
			providerPicker,
			streamCapturedOutput,
		],
	);

	const handleMouseClick = useCallback(
		(event: MouseClickEvent) => {
			if (scrollbackOffset > 0) {
				focusInput();
				return;
			}

			const policyActions = resolveClickAction(
				{
					isExiting,
					hasProviderPicker: Boolean(providerPicker),
					hasSlashQuickOptions: slashQuickOptionsVisible,
				},
				{
					shift: event.shift,
					ctrl: event.ctrl,
					meta: event.meta,
				},
			);

			for (const action of policyActions) {
				if (action === "none") return;
				if (action === "hit-test") continue;
				if (action === "close-provider-picker") {
					closeProviderPicker();
					return;
				}
				if (action === "dismiss-slash-quick-options") {
					setSlashQuickDismissed(true);
					continue;
				}
				if (action === "focus-input") {
					focusInput();
					return;
				}
				if (action === "focus-next") {
					focusNext();
					return;
				}
				if (action === "focus-previous") {
					focusPrevious();
					return;
				}
			}

			const cursorRow = cursorRowRef.current;
			if (!cursorRow) {
				focusInput();
				return;
			}

			const appTopRow = cursorRow - clickLayout.inputCursorRow + 1;
			const relativeRow = event.y - appTopRow + 1;

			if (
				relativeRow >= clickLayout.inputStart &&
				relativeRow <= clickLayout.inputEnd
			) {
				focusInput();
				return;
			}

			const targetThinking = clickLayout.thinkingRanges.find(
				(range) => relativeRow >= range.start && relativeRow <= range.end,
			);
			if (targetThinking) {
				if (focusedThinkingId === targetThinking.id) {
					toggleThinkingGroup(targetThinking.id);
				} else {
					focus(`meta-${targetThinking.id}`);
				}
				return;
			}

			focusInput();
		},
		[
			clickLayout.inputCursorRow,
			clickLayout.inputEnd,
			clickLayout.inputStart,
			clickLayout.thinkingRanges,
			closeProviderPicker,
			focus,
			focusInput,
			focusNext,
			focusPrevious,
			focusedThinkingId,
			isExiting,
			providerPicker,
			scrollbackOffset,
			slashQuickOptionsVisible,
			toggleThinkingGroup,
		],
	);
	const handleMouseClickRef = useRef(handleMouseClick);

	useEffect(() => {
		handleMouseClickRef.current = handleMouseClick;
	}, [handleMouseClick]);

	const handleMouseScroll = useCallback(
		(event: MouseScrollEvent) => {
			if (isExiting) return;

			if (scrollbackOffset > 0) {
				adjustScrollback(event.direction);
				return;
			}

			let inInputArea = false;
			const cursorRow = cursorRowRef.current;
			if (cursorRow !== null) {
				const appTopRow = cursorRow - clickLayout.inputCursorRow + 1;
				const relativeRow = event.y - appTopRow + 1;
				inInputArea =
					relativeRow >= clickLayout.inputStart &&
					relativeRow <= clickLayout.inputEnd;
			}

			if (!inInputArea) {
				adjustScrollback(event.direction);
				return;
			}

			// Scroll inside input (or unknown position): history navigation
			if (
				providerPicker ||
				slashQuickOptionsVisible ||
				isProcessing ||
				!inputFocused
			)
				return;

			if (event.direction === "up") {
				if (historyIdx === -1 && history.length > 0) {
					setSavedInput(input);
					setHistoryIdx(0);
					const firstHistoryEntry = history[0];
					if (firstHistoryEntry !== undefined) {
						replaceInput(firstHistoryEntry);
					}
				} else if (historyIdx >= 0 && historyIdx < history.length - 1) {
					const next = historyIdx + 1;
					const nextHistoryEntry = history[next];
					if (nextHistoryEntry === undefined) return;
					setHistoryIdx(next);
					replaceInput(nextHistoryEntry);
				}
			} else {
				if (historyIdx > 0) {
					const next = historyIdx - 1;
					const nextHistoryEntry = history[next];
					if (nextHistoryEntry === undefined) return;
					setHistoryIdx(next);
					replaceInput(nextHistoryEntry);
				} else if (historyIdx === 0) {
					setHistoryIdx(-1);
					replaceInput(savedInput);
					setSavedInput("");
				}
			}
		},
		[
			clickLayout.inputCursorRow,
			clickLayout.inputEnd,
			clickLayout.inputStart,
			history,
			historyIdx,
			input,
			inputFocused,
			adjustScrollback,
			isExiting,
			isProcessing,
			providerPicker,
			replaceInput,
			scrollbackOffset,
			savedInput,
			slashQuickOptionsVisible,
		],
	);

	const handleMouseScrollRef = useRef(handleMouseScroll);

	useEffect(() => {
		handleMouseScrollRef.current = handleMouseScroll;
	}, [handleMouseScroll]);

	useEffect(() => {
		if (!mouseCaptureEnabled || !isRawModeSupported || !stdin.isTTY) return;

		const enableMouse = "\u001b[?1000h\u001b[?1006h";
		const disableMouse = "\u001b[?1000l\u001b[?1006l";
		writeTerminal(enableMouse);
		writeTerminal("\u001b[6n");
		const originalRead = stdin.read.bind(stdin);
		const patchedRead = ((...args: unknown[]) => {
			const chunk = originalRead(...(args as Parameters<typeof originalRead>));
			if (chunk === null) return null;
			const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			const { clean, clicks, scrolls, cursorReports, remainder } =
				extractTerminalEvents(data, mouseRemainderRef.current);
			mouseRemainderRef.current = remainder;
			const lastCursorReport = cursorReports.at(-1);
			if (lastCursorReport) {
				cursorRowRef.current = lastCursorReport.row;
			}
			for (const click of clicks) {
				handleMouseClickRef.current(click);
			}
			for (const scroll of scrolls) {
				handleMouseScrollRef.current(scroll);
			}
			// Intercept Ctrl+V (\x16) when a clipboard image is pending
			if (pendingClipImageRef.current && clean.includes("\x16")) {
				const filteredClean = clean.replaceAll("\x16", "");
				handleClipboardPasteRef.current();
				if (filteredClean.length === 0) return null;
				if (typeof chunk === "string") return filteredClean;
				return Buffer.from(filteredClean, "utf8");
			}

			if (clean.length === 0) return null;
			if (typeof chunk === "string") return clean;
			return Buffer.from(clean, "utf8");
		}) as typeof stdin.read;
		(stdin as unknown as { read: typeof stdin.read }).read = patchedRead;

		return () => {
			(stdin as unknown as { read: typeof stdin.read }).read = originalRead;
			writeTerminal(disableMouse);
			mouseRemainderRef.current = "";
		};
	}, [isRawModeSupported, mouseCaptureEnabled, stdin, writeTerminal]);

	// ── Clipboard image polling ────────────────────────────────────────────────

	useEffect(() => {
		if (!process.stdout.isTTY) return;
		ensureScreenshotDir();
		let lastClipSize = 0;
		let busy = false;

		const timer = setInterval(() => {
			if (busy) return;
			busy = true;
			void clipboardImageSizeAsync()
				.then((size) => {
					busy = false;
					if (size > 0 && size !== lastClipSize) {
						lastClipSize = size;
						pendingClipImageRef.current = true;
						setImageHint(true);
					} else if (size === 0 && pendingClipImageRef.current) {
						lastClipSize = 0;
						pendingClipImageRef.current = false;
						setImageHint(false);
					}
				})
				.catch(() => {
					busy = false;
				});
		}, 600);

		return () => clearInterval(timer);
	}, []);

	// ── Submit handler ─────────────────────────────────────────────────────────

	const handleSubmit = useCallback(
		async (value: string) => {
			const trimmed = value.trim();
			replaceInput("");
			setHistoryIdx(-1);
			setScrollbackOffset(0);

			if (!trimmed) {
				focusInput();
				return;
			}

			// Add to history
			setHistory((prev) =>
				[trimmed, ...prev.filter((h) => h !== trimmed)].slice(
					0,
					MAX_HISTORY_ENTRIES,
				),
			);

			if (trimmed.startsWith("!")) {
				// ── Shell escape ──────────────────────────────────────────────────
				const shellCmd = value.replace(/^\s*!/, "");
				addLine(`  ! ${shellCmd}`, "shell");
				setIsProcessing(true);

				try {
					const proc = Bun.spawn(["sh", "-c", shellCmd], {
						stdout: "pipe",
						stderr: "pipe",
						cwd: process.cwd(),
						env: process.env,
					});

					const out = await new Response(proc.stdout).text();
					const err = await new Response(proc.stderr).text();
					await proc.exited;

					if (out.trim()) {
						addLines(out.trimEnd().split("\n"), "system");
					}
					if (err.trim()) {
						addLines(err.trimEnd().split("\n"), "error");
					}
					if (proc.exitCode !== 0) {
						addLine(`  exit ${proc.exitCode}`, "system");
					}
				} catch (err) {
					addLine(`  Shell error: ${err}`, "error");
				} finally {
					setIsProcessing(false);
					focusInput();
				}
			} else if (trimmed.startsWith("/")) {
				// ── Slash commands ────────────────────────────────────────────────
				const resolved = resolveCommand(trimmed);
				const [cmd, ...args] = resolved.split(/\s+/);

				if (cmd === "exit") {
					doExit();
					return;
				}

				if (cmd === "clear") {
					setLines([]);
					setActiveThinkingLabel(null);
					setScrollbackOffset(0);
					focusInput();
					return;
				}

				if (cmd === "provider" && args.length === 0) {
					await openProviderPicker();
					return;
				}

				setIsProcessing(true);
				setActiveThinkingLabel(null);
				await new Promise((resolve) => setTimeout(resolve, 0));
				let commandResult: CommandResult = {};
				await streamCapturedOutput(async () => {
					commandResult = await onCommand(cmd ?? "", args);
				});

				setActiveProvider(config.provider);

				const commandLines = commandResult.lines ?? [];
				if (commandLines.length > 0) {
					setLines((prev) =>
						appendCappedLines(
							prev,
							commandLines.map((line) => ({
								id: nextLineId(line.type),
								text: line.text,
								type: line.type,
								...(line.meta ? { meta: line.meta } : {}),
								...(line.isFirstAssistantInTurn
									? { isFirstAssistantInTurn: true }
									: {}),
							})),
							MAX_CONTENT_LINES,
						),
					);
				}

				if (commandResult.shouldExit) {
					doExit();
					return;
				}

				setHasAssistantStream(false);
				setIsProcessing(false);
				focusInput();
			} else {
				// ── Chat message ──────────────────────────────────────────────────
				// Resolve image placeholders → actual file paths before sending
				let message = trimmed;
				for (const [placeholder, filePath] of imageMapRef.current) {
					if (message.includes(placeholder)) {
						message = message.replaceAll(placeholder, filePath);
						imageMapRef.current.delete(placeholder);
					}
				}
				addLine(`  › ${trimmed}`, "user");
				const transcriptBatch: Array<{
					type: "user" | "assistant" | "tool" | "thinking" | "error";
					text: string;
					meta?: ContentLine["meta"];
				}> = [{ type: "user", text: `  › ${trimmed}` }];
				setIsProcessing(true);
				setActiveThinkingLabel(null);
				setHasAssistantStream(false);
				let assistantLineId: string | null = null;
				let assistantSegmentBuffer = "";
				let lastThinking = "";
				let isFirstAssistantLine = true;
				const finalizeAssistantSegment = () => {
					if (!assistantLineId) {
						assistantSegmentBuffer = "";
						return;
					}
					if (assistantSegmentBuffer.trim()) {
						transcriptBatch.push({
							type: "assistant",
							text: assistantSegmentBuffer,
						});
					}
					assistantLineId = null;
					assistantSegmentBuffer = "";
				};

				const hooks: ChatRenderHooks = {
					onThinkingStart: (label) => {
						finalizeAssistantSegment();
						setActiveThinkingLabel(label);
					},
					onThinking: (text) => {
						const note = text.trim();
						if (!note || note === lastThinking) return;
						finalizeAssistantSegment();
						lastThinking = note;
						setActiveThinkingLabel(null);
						const line = `  💭 ${note}`;
						const firstInTurn = isFirstAssistantLine;
						if (firstInTurn) isFirstAssistantLine = false;
						addLine(line, "thinking", undefined, firstInTurn);
						transcriptBatch.push({ type: "thinking", text: line });
					},
					onTool: (name, preview) => {
						finalizeAssistantSegment();
						setActiveThinkingLabel(null);
						const item = preview ? `${name} ${preview}` : name;
						const line = `  📖 ${item}`;
						addLine(line, "tool");
						transcriptBatch.push({ type: "tool", text: line });
					},
					onToolDiff: (meta) => {
						finalizeAssistantSegment();
						setActiveThinkingLabel(null);
						const line = `  ${summarizeToolDiff(meta)}`;
						addLine(line, "tool", meta);
						transcriptBatch.push({ type: "tool", text: line, meta });
					},
					onToolSummary: (summary) => {
						finalizeAssistantSegment();
						setActiveThinkingLabel(null);
						const line = `  ${summary}`;
						addLine(line, "tool");
						transcriptBatch.push({ type: "tool", text: line });
					},
					onText: (text) => {
						setActiveThinkingLabel(null);
						setHasAssistantStream(true);
						assistantSegmentBuffer += text;
						if (!assistantLineId) {
							const nextAssistantLineId = nextLineId("assistant-stream");
							assistantLineId = nextAssistantLineId;
							const firstInTurn = isFirstAssistantLine;
							isFirstAssistantLine = false;
							setLines((prev) =>
								appendCappedLines(
									prev,
									[
										{
											id: nextAssistantLineId,
											text: assistantSegmentBuffer,
											type: "assistant",
											...(firstInTurn ? { isFirstAssistantInTurn: true } : {}),
										},
									],
									MAX_CONTENT_LINES,
								),
							);
						} else {
							updateLineById(assistantLineId, assistantSegmentBuffer);
						}
					},
					onError: (text) => {
						finalizeAssistantSegment();
						setActiveThinkingLabel(null);
						const line = `  ${text}`;
						addLine(line, "error");
						transcriptBatch.push({ type: "error", text: line });
					},
					onPlanIntent: (goal) => {
						planGoal = goal;
					},
				};

				let planGoal: string | null = null;
				await chatSession.send(message, hooks);

				const askGoal = planGoal;
				if (askGoal) {
					// LLM detected a planning task — route to ask flow
					try {
						await streamCapturedOutput(async () => {
							await onCommand("ask", [askGoal]);
						});
					} catch (err) {
						addLine(`  Plan failed: ${String(err)}`, "error");
					}
					setActiveProvider(config.provider);
					setHasAssistantStream(false);
				} else {
					finalizeAssistantSegment();
					await chatSession.appendTranscript(transcriptBatch);
					setActiveThinkingLabel(null);
					setHasAssistantStream(false);
				}
				setIsProcessing(false);
				focusInput();
			}
		},
		[
			addLine,
			addLines,
			chatSession,
			config.provider,
			doExit,
			onCommand,
			openProviderPicker,
			nextLineId,
			focusInput,
			replaceInput,
			streamCapturedOutput,
			updateLineById,
		],
	);

	const applySlashQuickOption = useCallback(
		(index: number) => {
			const selected = slashQuickOptions[index];
			if (!selected) return;
			if (selected.requiresArgs) {
				replaceInput(selected.commandText);
				return;
			}
			void handleSubmit(selected.commandText);
		},
		[handleSubmit, replaceInput, slashQuickOptions],
	);

	useInput((_ch, key) => {
		if (isExiting || providerPicker || !slashQuickOptionsVisible) return;
		const total = slashQuickOptions.length;
		if (total === 0) return;

		if (key.downArrow || (key.tab && !key.shift)) {
			setSlashQuickIndex((prev) => (prev + 1) % total);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.upArrow || (key.tab && key.shift)) {
			setSlashQuickIndex((prev) => (prev - 1 + total) % total);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.escape) {
			setSlashQuickDismissed(true);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.return) {
			applySlashQuickOption(slashQuickIndex);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.rightArrow) {
			const selected = slashQuickOptions[slashQuickIndex];
			if (!selected) return;
			replaceInput(selected.commandText);
			focus(INPUT_FOCUS_ID);
		}
	});

	useInput((_ch, key) => {
		if (isExiting || !providerPicker) return;
		const total = providerPicker.options.length;
		if (total === 0) return;

		if (key.downArrow || (key.tab && !key.shift)) {
			setProviderPickerIndex((prev) => (prev + 1) % total);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.upArrow || (key.tab && key.shift)) {
			setProviderPickerIndex((prev) => (prev - 1 + total) % total);
			focus(INPUT_FOCUS_ID);
			return;
		}

		if (key.return) {
			void submitProviderPicker(providerPickerIndex);
			return;
		}

		if (key.escape) {
			closeProviderPicker();
			return;
		}

		if (key.ctrl && (_ch === "c" || _ch === "d")) {
			closeProviderPicker();
		}
	});

	// ── History navigation ─────────────────────────────────────────────────────

	useInput((_ch, key) => {
		if (scrollbackOffset > 0) {
			if (key.escape) {
				setScrollbackOffset(0);
				focusInput();
				return;
			}

			if (key.pageUp) {
				adjustScrollback("up", Math.max(1, scrollbackViewportRows - 1));
				return;
			}

			if (key.pageDown) {
				adjustScrollback("down", Math.max(1, scrollbackViewportRows - 1));
				return;
			}

			if (key.upArrow) {
				adjustScrollback("up");
				return;
			}

			if (key.downArrow) {
				adjustScrollback("down");
			}
			return;
		}

		if (
			isExiting ||
			providerPicker ||
			slashQuickOptionsVisible ||
			isProcessing ||
			!inputFocused
		)
			return;
		if (key.upArrow) {
			if (historyIdx === -1 && history.length > 0) {
				setSavedInput(input);
				setHistoryIdx(0);
				const firstHistoryEntry = history[0];
				if (firstHistoryEntry !== undefined) {
					replaceInput(firstHistoryEntry);
				}
			} else if (historyIdx >= 0 && historyIdx < history.length - 1) {
				const next = historyIdx + 1;
				const nextHistoryEntry = history[next];
				if (nextHistoryEntry === undefined) return;
				setHistoryIdx(next);
				replaceInput(nextHistoryEntry);
			}
		} else if (key.downArrow) {
			if (historyIdx > 0) {
				const next = historyIdx - 1;
				const nextHistoryEntry = history[next];
				if (nextHistoryEntry === undefined) return;
				setHistoryIdx(next);
				replaceInput(nextHistoryEntry);
			} else if (historyIdx === 0) {
				setHistoryIdx(-1);
				replaceInput(savedInput);
				setSavedInput("");
			}
		}
	});

	// ── Ctrl+C / Ctrl+D to exit ────────────────────────────────────────────────

	useInput((_ch, key) => {
		if (isExiting || providerPicker) return;
		if (key.ctrl && (_ch === "c" || _ch === "d")) {
			doExit();
		}
	});

	// ── Render ─────────────────────────────────────────────────────────────────

	const renderContentLine = useCallback((line: ContentLine) => {
		const label = line.isFirstAssistantInTurn ? "›" : getContentLineLabel(line);
		const bodyText =
			line.type === "assistant"
				? renderMarkdown(line.text)
				: getContentLineText(line);
		const bodyLines = bodyText.split("\n");
		const hasLeadingColumn = hasContentLineLeadingColumn(line);

		if (!hasLeadingColumn) {
			return (
				<Text
					key={line.id}
					dimColor={line.type === "shell"}
					color={line.type === "error" ? "red" : undefined}
				>
					{bodyText}
				</Text>
			);
		}

		// Label color/weight per role:
		//   user      → yellow + bold
		//   assistant → no color (undefined) + bold
		//   error     → red + bold
		//   thinking  → gray + dim
		//   tool      → gray + dim
		const labelColor =
			line.type === "user"
				? "yellow"
				: line.type === "error"
					? "red"
					: line.type === "assistant"
						? undefined
						: "gray";
		const labelBold =
			line.type === "user" ||
			line.type === "assistant" ||
			line.type === "error";
		const labelDim = line.type === "thinking" || line.type === "tool";
		const bodyColor =
			line.type === "error"
				? "red"
				: line.type === "thinking"
					? "gray"
					: line.type === "tool"
						? "cyan"
						: undefined;
		const bodyDim =
			line.type === "thinking" || line.type === "tool" || line.type === "shell";
		const bodyWidth = getContentBodyWidth(
			Math.max(20, stdout.columns ?? 80),
			hasLeadingColumn,
		);

		return (
			<Box key={line.id} width="100%" flexDirection="column">
				{bodyLines.map((bodyLine, index) => (
					<Box key={`${line.id}-${index}`} width="100%">
						<Box
							width={CONTENT_LABEL_WIDTH}
							marginRight={CONTENT_LABEL_GAP}
							flexShrink={0}
						>
							{index === 0 && label ? (
								<Text color={labelColor} bold={labelBold} dimColor={labelDim}>
									{label}
								</Text>
							) : null}
						</Box>
						<Box flexGrow={1}>
							<Text color={bodyColor} dimColor={bodyDim}>
								{bodyLine.length > 0 ? bodyLine : " "}
							</Text>
						</Box>
					</Box>
				))}
				{line.meta?.kind === "plan-preview" ? (
					<Box width="100%">
						<Box
							width={CONTENT_LABEL_WIDTH}
							marginRight={CONTENT_LABEL_GAP}
							flexShrink={0}
						/>
						<Box flexGrow={1} flexDirection="column">
							<PlanTaskTree
								plans={[line.meta.plan]}
								terminalWidth={bodyWidth}
							/>
						</Box>
					</Box>
				) : null}
			</Box>
		);
	}, [stdout.columns]);

	const scrollbackSnapshotLines = useMemo(() => {
		if (scrollbackOffset === 0) return [];

		const terminalWidth = Math.max(20, stdout.columns ?? 80);
		const snapshot = renderToString(
			<Box flexDirection="column" width={terminalWidth}>
				{renderItems.map((item) =>
					item.kind === "meta-group" ? (
						<ThinkingCollapsibleLine
							key={`scrollback-${item.id}`}
							groupId={`scrollback-${item.id}`}
							groupType={item.groupType}
							lines={item.lines}
							expanded={expandedThinkingIds.has(item.id)}
							isActive={false}
							isStreaming={isProcessing && streamingMetaGroupId === item.id}
							onToggle={() => {}}
							onFocusChange={() => {}}
						/>
					) : (
						renderContentLine(item.line)
					),
				)}
				{displayPlan && !isExiting ? (
					<Box flexDirection="column" marginTop={1}>
						<PlanTaskTree
							plans={[displayPlan]}
							taskLogs={planTaskLogs}
							terminalWidth={terminalWidth}
						/>
					</Box>
				) : null}
			</Box>,
			{ columns: terminalWidth },
		);

		return extractScrollbackSnapshotLines(snapshot);
	}, [
		displayPlan,
		expandedThinkingIds,
		isExiting,
		isProcessing,
		planTaskLogs,
		renderContentLine,
		renderItems,
		scrollbackOffset,
		stdout.columns,
		streamingMetaGroupId,
	]);
	const scrollbackVisibleRows = Math.max(1, scrollbackViewportRows - 1);
	const scrollbackMaxOffset = Math.max(
		0,
		scrollbackSnapshotLines.length - scrollbackVisibleRows,
	);
	const [scrollbackStart, scrollbackEnd] = useMemo(
		() =>
			computeScrollbackWindow(
				scrollbackSnapshotLines.length,
				scrollbackVisibleRows,
				scrollbackOffset,
			),
		[scrollbackSnapshotLines.length, scrollbackVisibleRows, scrollbackOffset],
	);
	const visibleScrollbackLines = useMemo(
		() => scrollbackSnapshotLines.slice(scrollbackStart, scrollbackEnd),
		[scrollbackEnd, scrollbackSnapshotLines, scrollbackStart],
	);

	useEffect(() => {
		if (scrollbackOffset === 0) return;
		setScrollbackOffset((prev) => Math.min(prev, scrollbackMaxOffset));
	}, [scrollbackMaxOffset, scrollbackOffset]);

	return (
		<Box flexDirection="column">
			<WelcomePanel
				provider={activeProvider}
				useRtk={config.use_rtk ?? false}
			/>
			{scrollbackOffset > 0 ? (
				<Box
					flexDirection="column"
					height={scrollbackViewportRows}
					overflowY="hidden"
				>
					<Text color="gray" dimColor>
						{`Scrollback · ${scrollbackOffset} lines up · wheel ↓ or Esc to return`}
					</Text>
					{visibleScrollbackLines.map((line, index) => (
						<Text key={`scrollback-line-${scrollbackStart + index}`}>
							{line.length > 0 ? line : " "}
						</Text>
					))}
				</Box>
				) : showPlanFocusView ? (
					<Box flexDirection="column" marginTop={1}>
						<Text color="cyan" bold>
							Execution Plan
						</Text>
						<Text color="gray" dimColor>
							Live task updates while the run is active.
						</Text>
						<Box marginTop={1}>
							<PlanTaskTree
								plans={displayPlan ? [displayPlan] : []}
								taskLogs={planTaskLogs}
								terminalWidth={Math.max(20, stdout.columns ?? 80)}
							/>
						</Box>
					</Box>
				) : (
					<>
						{/* All content lines */}
						{renderItems.map((item) =>
						item.kind === "meta-group" ? (
							<ThinkingCollapsibleLine
								key={item.id}
								groupId={item.id}
								groupType={item.groupType}
								lines={item.lines}
								expanded={expandedThinkingIds.has(item.id)}
								isActive={
									!isExiting && !providerPicker && !slashQuickOptionsVisible
								}
								isStreaming={isProcessing && streamingMetaGroupId === item.id}
								onToggle={() => toggleThinkingGroup(item.id)}
								onFocusChange={(focused) => {
									if (focused) {
										setFocusedThinkingId(item.id);
										return;
									}
									setFocusedThinkingId((prev) =>
										prev === item.id ? null : prev,
									);
								}}
							/>
						) : (
							renderContentLine(item.line)
						),
					)}
					{displayPlan && !isExiting ? (
						<Box flexDirection="column" marginTop={1}>
							<PlanTaskTree
								plans={[displayPlan]}
								taskLogs={planTaskLogs}
								terminalWidth={Math.max(20, stdout.columns ?? 80)}
							/>
						</Box>
						) : null}
					</>
				)}
			{!isExiting && globalStatus ? (
				<StatusBar
					phase={globalStatus.phase}
					label={globalStatus.label}
					terminalWidth={Math.max(20, stdout.columns ?? 80)}
				/>
			) : null}

			{!isExiting && (
				<InputPanel
					input={input}
					inputResetKey={inputResetKey}
					statusDivider={statusDivider}
					statusInfo={statusInfo}
					suggestions={slashSuggestionHints}
					isActive
					inputDisabled={Boolean(providerPicker)}
					isProcessing={isProcessing}
					canSubmit={
						!isProcessing &&
						providerPicker === null &&
						!slashQuickOptionsVisible
					}
					imageHint={imageHint && !isProcessing}
					onChange={handleInputChange}
					onSubmit={handleSubmit}
					onFocusChange={(focused) => {
						setInputFocused(focused);
						if (focused) setFocusedThinkingId(null);
					}}
					slashOptions={slashQuickOptionsVisible ? slashQuickOptions : []}
					slashSelectedIndex={slashQuickIndex}
					providerOptions={providerPicker ? providerQuickOptions : []}
					providerSelectedIndex={providerPickerIndex}
				/>
			)}
		</Box>
	);
}
