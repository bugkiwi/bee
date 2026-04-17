/**
 * Tests for the Ink App component logic and session summary.
 *
 * We test:
 * 1. getSessionSummaryLines returns proper lines (not void)
 * 2. Exit flow: summary lines rendered before exit
 * 3. Natural flow layout: input follows content, thinking shown inline
 */

import { describe, expect, it } from "bun:test";
import { PlanStatus } from "../types/plan.ts";
import {
	appendCappedLines,
	buildScrollbackSnapshotLines,
	buildInputPlanSummary,
	capContentLines,
	computeScrollbackWindow,
	extractCapturedOutputChunk,
	extractScrollbackSnapshotLines,
	formatPlanSummaryHash,
	getInputPanelRows,
	shouldRenderPlanFocusView,
} from "../cli/ui/App.tsx";

// ─── Import and test getSessionSummaryLines ──────────────────────────────────
// We need to test it as a pure function, so we import the module.
// Since it's not exported, we replicate the logic here for unit testing.

/** Minimal ChatSession stats shape for testing. */
interface SessionStats {
	messages: number;
	totalTools: number;
	durationMs: number;
	linesChanged: number;
	toolCounts: Map<string, number>;
}

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rem = s % 60;
	if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const remM = m % 60;
	return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function getSessionSummaryLines(
	stats: SessionStats,
	sessionId?: string,
): string[] {
	if (stats.messages === 0 && stats.totalTools === 0) {
		return ["", "Bye.", ""];
	}

	const W = 44;
	const border = "─".repeat(W);

	const dur = formatDuration(stats.durationMs);
	const msgs = `${stats.messages} msg${stats.messages !== 1 ? "s" : ""}`;
	const tools = `${stats.totalTools} tool${stats.totalTools !== 1 ? "s" : ""}`;

	const parts: string[] = [
		"",
		`╭${border}╮`,
		`  🐝  Session Summary`,
		`├${border}┤`,
		`  ⏱  ${dur}   💬 ${msgs}`,
		`  🔧 ${tools}`,
	];

	if (sessionId) {
		parts.push(`├${border}┤`);
		parts.push(`  Resume: bee --resume ${sessionId.slice(0, 8)}`);
	}

	parts.push(`╰${border}╯`, "");
	return parts;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getSessionSummaryLines", () => {
	it("returns 'Bye.' lines when no messages and no tools", () => {
		const lines = getSessionSummaryLines({
			messages: 0,
			totalTools: 0,
			durationMs: 0,
			linesChanged: 0,
			toolCounts: new Map(),
		});
		expect(lines).toEqual(["", "Bye.", ""]);
	});

	it("returns string[] (not void) — can be used as content lines", () => {
		const lines = getSessionSummaryLines({
			messages: 0,
			totalTools: 0,
			durationMs: 0,
			linesChanged: 0,
			toolCounts: new Map(),
		});
		expect(Array.isArray(lines)).toBe(true);
		expect(lines.length).toBeGreaterThan(0);
		expect(typeof lines[0]).toBe("string");
	});

	it("returns summary box when there are messages", () => {
		const lines = getSessionSummaryLines({
			messages: 5,
			totalTools: 12,
			durationMs: 125000,
			linesChanged: 42,
			toolCounts: new Map([
				["Read", 5],
				["Edit", 3],
				["Bash", 4],
			]),
		});
		const text = lines.join("\n");
		expect(text).toContain("Session Summary");
		expect(text).toContain("5 msgs");
		expect(text).toContain("12 tools");
		expect(text).toContain("2m 5s");
	});

	it("includes resume hint when sessionId is provided", () => {
		const lines = getSessionSummaryLines(
			{
				messages: 1,
				totalTools: 1,
				durationMs: 1000,
				linesChanged: 0,
				toolCounts: new Map(),
			},
			"abcdef12-3456-7890",
		);
		const text = lines.join("\n");
		expect(text).toContain("Resume:");
		expect(text).toContain("abcdef12");
	});

	it("does NOT include resume hint when no sessionId", () => {
		const lines = getSessionSummaryLines({
			messages: 1,
			totalTools: 1,
			durationMs: 1000,
			linesChanged: 0,
			toolCounts: new Map(),
		});
		const text = lines.join("\n");
		expect(text).not.toContain("Resume:");
	});
});

describe("formatDuration", () => {
	it("formats seconds", () => {
		expect(formatDuration(5000)).toBe("5s");
		expect(formatDuration(59000)).toBe("59s");
	});

	it("formats minutes", () => {
		expect(formatDuration(60000)).toBe("1m");
		expect(formatDuration(90000)).toBe("1m 30s");
	});

	it("formats hours", () => {
		expect(formatDuration(3600000)).toBe("1h");
		expect(formatDuration(5400000)).toBe("1h 30m");
	});
});

describe("App component content flow (unit logic)", () => {
	// These test the content line model used by the App component.
	// We verify the data flow rather than rendering (which requires a full Ink test harness).

	interface ContentLine {
		id: string;
		text: string;
		type:
			| "banner"
			| "user"
			| "assistant"
			| "system"
			| "tool"
			| "shell"
			| "error"
			| "thinking";
	}

	function makeBannerLines(banner: string): ContentLine[] {
		return banner.split("\n").map((text, i) => ({
			id: `banner-${i}`,
			text,
			type: "banner" as const,
		}));
	}

	function addLine(
		lines: ContentLine[],
		text: string,
		type: ContentLine["type"],
	): ContentLine[] {
		return [
			...lines,
			{ id: `${type}-${Date.now()}-${Math.random()}`, text, type },
		];
	}

	function addThinking(lines: ContentLine[]): ContentLine[] {
		return addLine(lines, "  🐝 thinking…", "thinking");
	}

	function removeThinking(lines: ContentLine[]): ContentLine[] {
		return lines.filter((l) => l.type !== "thinking");
	}

	it("banner lines come first, then input follows naturally", () => {
		const banner = "line1\nline2\nline3";
		const lines = makeBannerLines(banner);
		// Input would be rendered AFTER these lines by the component
		expect(lines).toHaveLength(3);
		expect(lines[0]!.type).toBe("banner");
		expect(lines[2]!.type).toBe("banner");
	});

	it("user message becomes a content line after submit", () => {
		let lines: ContentLine[] = makeBannerLines("banner");
		// Simulate submit
		lines = addLine(lines, "  › hello world", "user");
		expect(lines[lines.length - 1]!.text).toBe("  › hello world");
		expect(lines[lines.length - 1]!.type).toBe("user");
	});

	it("thinking indicator appears below user message", () => {
		let lines: ContentLine[] = makeBannerLines("banner");
		lines = addLine(lines, "  › hello world", "user");
		lines = addThinking(lines);

		const lastTwo = lines.slice(-2);
		expect(lastTwo[0]!.type).toBe("user");
		expect(lastTwo[1]!.type).toBe("thinking");
		expect(lastTwo[1]!.text).toContain("thinking");
	});

	it("thinking indicator is removed when response arrives", () => {
		let lines: ContentLine[] = makeBannerLines("banner");
		lines = addLine(lines, "  › hello", "user");
		lines = addThinking(lines);
		expect(lines.some((l) => l.type === "thinking")).toBe(true);

		// Response arrives
		lines = removeThinking(lines);
		lines = addLine(lines, "  Here is my response", "assistant");

		expect(lines.some((l) => l.type === "thinking")).toBe(false);
		expect(lines[lines.length - 1]!.type).toBe("assistant");
	});

	it("exit appends summary lines to content", () => {
		let lines: ContentLine[] = makeBannerLines("banner");
		lines = addLine(lines, "  › test", "user");
		lines = addLine(lines, "  response", "assistant");

		// Simulate doExit: add summary lines
		const summaryLines = ["", "Bye.", ""];
		const withSummary = [
			...lines,
			...summaryLines.map((text, i) => ({
				id: `exit-${i}`,
				text,
				type: "system" as const,
			})),
		];

		// Summary is part of the content, not a separate console.log
		expect(withSummary.length).toBe(lines.length + summaryLines.length);
		expect(withSummary[withSummary.length - 2]!.text).toBe("Bye.");
	});

	it("multiple chat rounds: each ask+response appended in order", () => {
		let lines: ContentLine[] = makeBannerLines("B");

		// Round 1
		lines = addLine(lines, "  › q1", "user");
		lines = addThinking(lines);
		lines = removeThinking(lines);
		lines = addLine(lines, "  a1", "assistant");

		// Round 2
		lines = addLine(lines, "  › q2", "user");
		lines = addThinking(lines);
		lines = removeThinking(lines);
		lines = addLine(lines, "  a2", "assistant");

		const nonBanner = lines.filter((l) => l.type !== "banner");
		expect(nonBanner.map((l) => l.type)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		expect(nonBanner.map((l) => l.text)).toEqual([
			"  › q1",
			"  a1",
			"  › q2",
			"  a2",
		]);
	});

	it("shell command output appears after shell line", () => {
		let lines: ContentLine[] = makeBannerLines("B");
		lines = addLine(lines, "  ! ls", "shell");
		lines = addLine(lines, "file1.ts", "system");
		lines = addLine(lines, "file2.ts", "system");

		const nonBanner = lines.filter((l) => l.type !== "banner");
		expect(nonBanner[0]!.type).toBe("shell");
		expect(nonBanner[1]!.type).toBe("system");
		expect(nonBanner[2]!.type).toBe("system");
	});
});

describe("App memory guards", () => {
	it("capContentLines keeps only the tail window", () => {
		expect(capContentLines([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
	});

	it("appendCappedLines trims old entries after append", () => {
		expect(appendCappedLines(["a", "b"], ["c", "d"], 3)).toEqual([
			"b",
			"c",
			"d",
		]);
	});

	it("extractCapturedOutputChunk emits complete lines and retains partial tail", () => {
		const first = extractCapturedOutputChunk("", "one\ntwo");
		expect(first.lines).toEqual(["one"]);
		expect(first.remainder).toBe("two");

		const second = extractCapturedOutputChunk(first.remainder, "\nthree\n");
		expect(second.lines).toEqual(["two", "three"]);
		expect(second.remainder).toBe("");
	});

	it("extractCapturedOutputChunk normalizes carriage returns and strips ansi codes", () => {
		const result = extractCapturedOutputChunk(
			"",
			"\u001b[31mred\u001b[0m\rplain\r\n",
		);
		expect(result.lines).toEqual(["red", "plain"]);
		expect(result.remainder).toBe("");
	});
});

describe("App scrollback helpers", () => {
	it("captures a snapshot once when entering scrollback", async () => {
		const { advanceScrollbackState } = await import("../cli/ui/App.tsx");
		const next = advanceScrollbackState(
			{ offset: 0, snapshotLines: [] },
			"up",
			4,
			["alpha", "beta"],
		);

		expect(next).toEqual({
			offset: 4,
			snapshotLines: ["alpha", "beta"],
		});
	});

	it("keeps the existing snapshot while scrolling further up", async () => {
		const { advanceScrollbackState } = await import("../cli/ui/App.tsx");
		const next = advanceScrollbackState(
			{ offset: 4, snapshotLines: ["alpha", "beta"] },
			"up",
			4,
			["new"],
		);

		expect(next).toEqual({
			offset: 8,
			snapshotLines: ["alpha", "beta"],
		});
	});

	it("clears the snapshot when scrollback returns to the live view", async () => {
		const { advanceScrollbackState } = await import("../cli/ui/App.tsx");
		const next = advanceScrollbackState(
			{ offset: 4, snapshotLines: ["alpha", "beta"] },
			"down",
			4,
		);

		expect(next).toEqual({
			offset: 0,
			snapshotLines: [],
		});
	});

	it("requests a snapshot only while scrollback is active and empty", async () => {
		const { shouldCaptureScrollbackSnapshot } = await import("../cli/ui/App.tsx");

		expect(
			shouldCaptureScrollbackSnapshot({ offset: 4, snapshotLines: [] }),
		).toBe(true);
		expect(
			shouldCaptureScrollbackSnapshot({ offset: 4, snapshotLines: ["alpha"] }),
		).toBe(false);
		expect(
			shouldCaptureScrollbackSnapshot({ offset: 0, snapshotLines: [] }),
		).toBe(false);
	});

	it("does not clamp scrollback back to live view before the snapshot exists", async () => {
		const { clampScrollbackState } = await import("../cli/ui/App.tsx");

		expect(
			clampScrollbackState({ offset: 4, snapshotLines: [] }, 0),
		).toEqual({
			offset: 4,
			snapshotLines: [],
		});
		expect(
			clampScrollbackState({ offset: 4, snapshotLines: ["alpha"] }, 0),
		).toEqual({
			offset: 0,
			snapshotLines: [],
		});
	});

	it("computes the tail-aligned visible window", () => {
		expect(computeScrollbackWindow(10, 4, 0)).toEqual([6, 10]);
		expect(computeScrollbackWindow(10, 4, 2)).toEqual([4, 8]);
	});

	it("clamps oversized scroll offsets to the oldest available line", () => {
		expect(computeScrollbackWindow(5, 3, 99)).toEqual([0, 3]);
	});

	it("normalizes render snapshots into plain text lines", () => {
		expect(
			extractScrollbackSnapshotLines("alpha\r\nbeta\u001b[31m!\u001b[0m\n\n"),
		).toEqual(["alpha", "beta!"]);
	});

	it("builds scrollback snapshot lines directly from render items", () => {
		const plan = {
			id: "plan-1",
			title: "Execution Plan",
			description: "Execution Plan",
			status: PlanStatus.running,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			tasks: [
				{
					id: "task-1",
					title: "Investigate crash",
					description: "Inspect the latest crash log",
					status: PlanStatus.running,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			],
		};

		const lines = buildScrollbackSnapshotLines(
			[
				{
					kind: "line",
					line: { id: "u1", type: "user", text: "  › hello" },
				},
				{
					kind: "meta-group",
					id: "meta-1",
					groupType: "thinking",
					lines: [{ id: "t1", type: "thinking", text: "  💭 tracing root cause" }],
				},
			],
			{
				displayPlan: plan,
				planTaskLogs: { "task-1": ["latest breadcrumb captured"] },
				planTimelineEvents: [
					{ tone: "info", text: "Starting #1" },
					{ tone: "success", text: "#0 complete" },
				],
				expandedThinkingIds: new Set<string>(),
				isProcessing: false,
				streamingMetaGroupId: null,
			},
		);

		expect(lines).toContain("› hello");
		expect(lines).toContain("▶ [tracing root cause]");
		expect(lines).toContain("▶ Execution Plan");
		expect(lines).toContain("Execution Flow");
		expect(lines).toContain("→ Starting #1");
		expect(lines).toContain("└─ • ▶ #1 Investigate crash › in progress");
	});

	it("matches input panel height for picker and slash-option states", () => {
		expect(getInputPanelRows(0, 0)).toBe(6);
		expect(getInputPanelRows(0, 0, true)).toBe(7);
		expect(getInputPanelRows(3, 0)).toBe(11);
		expect(getInputPanelRows(0, 2)).toBe(10);
	});
});

describe("App plan summary helpers", () => {
	it("extracts the first 8 chars from the plan hash suffix", () => {
		expect(
			formatPlanSummaryHash("skeleton_2cb8fb4f66a8454198c67d361c7a4bc1"),
		).toBe("2cb8fb4f");
	});

	it("falls back to the raw id when there is no hash suffix", () => {
		expect(formatPlanSummaryHash("plan-1")).toBe("plan-1");
	});

	it("summarizes the active running task as compact input-panel metadata", () => {
		const plan = {
			id: "skeleton_2cb8fb4f66a8454198c67d361c7a4bc1",
			title: "Ship ACP wiring",
			description: "Ship ACP wiring",
			status: PlanStatus.running,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			tasks: [
				{
					id: "task-1",
					title: "Prepare fixtures",
					description: "Prepare fixtures",
					status: PlanStatus.completed,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				{
					id: "task-2",
					title: "Wire compact plan status into the input panel",
					description: "Wire compact plan status into the input panel",
					status: PlanStatus.running,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				{
					id: "task-3",
					title: "Polish truncation",
					description: "Polish truncation",
					status: PlanStatus.pending,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
			],
		};

		expect(buildInputPlanSummary(plan)).toEqual({
			planHash: "2cb8fb4f",
			progressLabel: "task 2/3",
			taskTitle: "Wire compact plan status into the input panel",
			taskStatus: PlanStatus.running,
		});
	});
});

describe("App plan focus mode", () => {
	it("shows the focused task view only while a plan is active and processing", () => {
		const plan = {
			id: "plan-1",
			title: "Focused plan",
			description: "Focused plan",
			status: PlanStatus.running,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			tasks: [],
		};

		expect(shouldRenderPlanFocusView(plan, true)).toBe(true);
		expect(shouldRenderPlanFocusView(plan, false)).toBe(false);
		expect(shouldRenderPlanFocusView(null, true)).toBe(false);
	});
});
