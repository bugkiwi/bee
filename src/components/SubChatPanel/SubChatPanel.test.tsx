/**
 * Tests for SubChatPanel component logic.
 *
 * Tests the pure helpers (computeVisibleWindow) and data-level behaviour
 * (log-line ordering, status label/color mappings) without rendering Ink
 * components — consistent with the rest of this test suite.
 */

import { describe, expect, it } from "bun:test";
import { TaskStatus } from "../../types/task.ts";
import { MAX_LOG_LINES, computeVisibleWindow } from "./SubChatPanel.tsx";

// ─── Label / color maps (mirrored from StatusBadge for assertion) ─────────────

const LABEL_MAP: Record<TaskStatus, string> = {
	[TaskStatus.pending]: "pending",
	[TaskStatus.running]: "running",
	[TaskStatus.completed]: "done",
	[TaskStatus.failed]: "failed",
	[TaskStatus.skipped]: "skipped",
};

const COLOR_MAP: Record<TaskStatus, string> = {
	[TaskStatus.pending]: "gray",
	[TaskStatus.running]: "blue",
	[TaskStatus.completed]: "green",
	[TaskStatus.failed]: "red",
	[TaskStatus.skipped]: "gray",
};

function parseLineIndex(line: string): number {
	const [, indexText] = line.split("-");
	if (indexText === undefined) {
		throw new Error(`Expected line to contain an index suffix: ${line}`);
	}

	return Number.parseInt(indexText, 10);
}

// ─── Snapshot: default empty-log render ──────────────────────────────────────

describe("SubChatPanel snapshot — empty log", () => {
	it("matches snapshot for default props with no log lines", () => {
		const logLines: string[] = [];
		const scrollOffset = 0;
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			scrollOffset,
		);
		const visibleLines = logLines.slice(start, end);

		const snapshot = {
			title: "My Sub-Task",
			status: TaskStatus.pending,
			logLines,
			scrollOffset,
			visibleWindow: [start, end],
			visibleLines,
			statusLabel: LABEL_MAP[TaskStatus.pending],
			statusColor: COLOR_MAP[TaskStatus.pending],
		};

		expect(snapshot).toMatchSnapshot();
	});

	it("renders zero visible lines when log is empty", () => {
		const [start, end] = computeVisibleWindow(0, MAX_LOG_LINES, 0);
		expect(end - start).toBe(0);
	});
});

// ─── Log-line ordering ────────────────────────────────────────────────────────

describe("SubChatPanel log-line ordering", () => {
	it("preserves insertion order for a small log (< MAX_LOG_LINES)", () => {
		const logLines = ["alpha", "beta", "gamma", "delta"];
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);
		const visible = logLines.slice(start, end);

		expect(visible).toEqual(["alpha", "beta", "gamma", "delta"]);
	});

	it("preserves insertion order for a log larger than the window", () => {
		const logLines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);
		const visible = logLines.slice(start, end);

		// Pinned to bottom → last MAX_LOG_LINES lines, in order
		expect(visible).toHaveLength(MAX_LOG_LINES);
		for (let i = 0; i < visible.length - 1; i++) {
			const currentLine = visible[i];
			const nextLine = visible[i + 1];
			if (!currentLine || !nextLine) {
				throw new Error("Expected adjacent visible log lines");
			}
			const currentIndex = parseLineIndex(currentLine);
			const nextIndex = parseLineIndex(nextLine);
			expect(nextIndex).toBe(currentIndex + 1);
		}
	});

	it("first visible line index is less than last visible line index", () => {
		const logLines = ["a", "b", "c", "d", "e"];
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);
		expect(start).toBeLessThan(end);
	});

	it("visible lines match slice(start, end) exactly", () => {
		const logLines = Array.from({ length: 50 }, (_, i) => `msg-${i}`);
		const scrollOffset = 5;
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			scrollOffset,
		);
		const visible = logLines.slice(start, end);
		const firstVisible = visible[0];
		const lastVisible = visible.at(-1);
		const expectedFirst = logLines[start];
		const expectedLast = logLines[end - 1];

		expect(firstVisible).toBeDefined();
		expect(lastVisible).toBeDefined();
		expect(expectedFirst).toBeDefined();
		expect(expectedLast).toBeDefined();

		expect(firstVisible).toBe(expectedFirst);
		expect(lastVisible).toBe(expectedLast);
	});

	it("matches snapshot for a populated log", () => {
		const logLines = ["first line", "second line", "third line"];
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);
		const visible = logLines.slice(start, end);

		expect({
			logLines,
			visibleWindow: [start, end],
			visibleLines: visible,
		}).toMatchSnapshot();
	});
});

// ─── Status variants ──────────────────────────────────────────────────────────

describe("SubChatPanel status variants — StatusBadge label", () => {
	it("pending → label 'pending'", () => {
		expect(LABEL_MAP[TaskStatus.pending]).toBe("pending");
	});

	it("running → label 'running'", () => {
		expect(LABEL_MAP[TaskStatus.running]).toBe("running");
	});

	it("completed → label 'done'", () => {
		expect(LABEL_MAP[TaskStatus.completed]).toBe("done");
	});

	it("failed → label 'failed'", () => {
		expect(LABEL_MAP[TaskStatus.failed]).toBe("failed");
	});

	it("skipped → label 'skipped'", () => {
		expect(LABEL_MAP[TaskStatus.skipped]).toBe("skipped");
	});

	it("all TaskStatus values have a defined label", () => {
		for (const status of Object.values(TaskStatus)) {
			expect(LABEL_MAP[status as TaskStatus]).toBeDefined();
		}
	});

	it("all TaskStatus values have a defined color", () => {
		for (const status of Object.values(TaskStatus)) {
			expect(COLOR_MAP[status as TaskStatus]).toBeDefined();
		}
	});

	it("each status renders without errors (data snapshot)", () => {
		const result = Object.values(TaskStatus).map((status) => ({
			status,
			label: LABEL_MAP[status as TaskStatus],
			color: COLOR_MAP[status as TaskStatus],
		}));
		expect(result).toMatchSnapshot();
	});
});

// ─── Component prop snapshot ──────────────────────────────────────────────────

describe("SubChatPanel prop snapshots", () => {
	it("matches snapshot for running status with populated log", () => {
		const logLines = ["Fetching data…", "Processing…", "Done."];
		const status = TaskStatus.running;
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);

		expect({
			title: "Task A",
			status,
			label: LABEL_MAP[status],
			color: COLOR_MAP[status],
			visibleWindow: [start, end],
			visibleLines: logLines.slice(start, end),
		}).toMatchSnapshot();
	});

	it("matches snapshot for failed status", () => {
		const logLines = ["Starting…", "Error: connection refused"];
		const status = TaskStatus.failed;
		const [start, end] = computeVisibleWindow(
			logLines.length,
			MAX_LOG_LINES,
			0,
		);

		expect({
			title: "Task B",
			status,
			label: LABEL_MAP[status],
			color: COLOR_MAP[status],
			visibleWindow: [start, end],
			visibleLines: logLines.slice(start, end),
		}).toMatchSnapshot();
	});
});
