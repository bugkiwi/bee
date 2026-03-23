/**
 * Tests for StatusBadge component color and label logic.
 *
 * We extract the pure mapping logic and test it directly
 * without rendering Ink components.
 */

import { describe, expect, it } from "bun:test";
import { getStatusColor, getStatusLabel } from "../components/StatusBadge.tsx";
import { PlanStatus } from "../types/plan.ts";
import { TaskStatus } from "../types/task.ts";

// ─── Color mapping ────────────────────────────────────────────────────────────

describe("StatusBadge color map", () => {
	it("maps pending to gray", () => {
		expect(getStatusColor(PlanStatus.pending)).toBe("gray");
		expect(getStatusColor(TaskStatus.pending)).toBe("gray");
	});

	it("maps running to blue", () => {
		expect(getStatusColor(PlanStatus.running)).toBe("blue");
		expect(getStatusColor(TaskStatus.running)).toBe("blue");
	});

	it("maps completed (done) to green", () => {
		expect(getStatusColor(PlanStatus.completed)).toBe("green");
		expect(getStatusColor(TaskStatus.completed)).toBe("green");
	});

	it("maps failed to red", () => {
		expect(getStatusColor(PlanStatus.failed)).toBe("red");
		expect(getStatusColor(TaskStatus.failed)).toBe("red");
	});

	it("maps paused to gray", () => {
		expect(getStatusColor(PlanStatus.paused)).toBe("gray");
	});

	it("maps skipped to gray", () => {
		expect(getStatusColor(TaskStatus.skipped)).toBe("gray");
	});
});

// ─── Label mapping ────────────────────────────────────────────────────────────

describe("StatusBadge label map", () => {
	it("labels pending as 'pending'", () => {
		expect(getStatusLabel(PlanStatus.pending)).toBe("pending");
		expect(getStatusLabel(TaskStatus.pending)).toBe("pending");
	});

	it("labels running as 'running'", () => {
		expect(getStatusLabel(PlanStatus.running)).toBe("running");
		expect(getStatusLabel(TaskStatus.running)).toBe("running");
	});

	it("labels completed as 'done'", () => {
		expect(getStatusLabel(PlanStatus.completed)).toBe("done");
		expect(getStatusLabel(TaskStatus.completed)).toBe("done");
	});

	it("labels failed as 'failed'", () => {
		expect(getStatusLabel(PlanStatus.failed)).toBe("failed");
		expect(getStatusLabel(TaskStatus.failed)).toBe("failed");
	});

	it("labels paused as 'paused'", () => {
		expect(getStatusLabel(PlanStatus.paused)).toBe("paused");
	});

	it("labels skipped as 'skipped'", () => {
		expect(getStatusLabel(TaskStatus.skipped)).toBe("skipped");
	});
});

// ─── Union type coverage ──────────────────────────────────────────────────────

describe("StatusBadge handles all PlanStatus values", () => {
	it("has a color for every PlanStatus value", () => {
		for (const value of Object.values(PlanStatus)) {
			expect(getStatusColor(value)).toBeDefined();
		}
	});

	it("has a label for every PlanStatus value", () => {
		for (const value of Object.values(PlanStatus)) {
			expect(getStatusLabel(value)).toBeDefined();
		}
	});
});

describe("StatusBadge handles all TaskStatus values", () => {
	it("has a color for every TaskStatus value", () => {
		for (const value of Object.values(TaskStatus)) {
			expect(getStatusColor(value)).toBeDefined();
		}
	});

	it("has a label for every TaskStatus value", () => {
		for (const value of Object.values(TaskStatus)) {
			expect(getStatusLabel(value)).toBeDefined();
		}
	});
});

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("StatusBadge snapshots", () => {
	it("COLOR_MAP matches snapshot", () => {
		const result = Object.fromEntries(
			[...Object.values(PlanStatus), ...Object.values(TaskStatus)].map(
				(status) => [status, getStatusColor(status)],
			),
		);
		expect(result).toMatchSnapshot();
	});

	it("LABEL_MAP matches snapshot", () => {
		const result = Object.fromEntries(
			[...Object.values(PlanStatus), ...Object.values(TaskStatus)].map(
				(status) => [status, getStatusLabel(status)],
			),
		);
		expect(result).toMatchSnapshot();
	});

	it("color/label pairs match snapshot for all PlanStatus values", () => {
		const result = Object.values(PlanStatus).map((s) => ({
			status: s,
			color: getStatusColor(s),
			label: getStatusLabel(s),
		}));
		expect(result).toMatchSnapshot();
	});

	it("color/label pairs match snapshot for all TaskStatus values", () => {
		const result = Object.values(TaskStatus).map((s) => ({
			status: s,
			color: getStatusColor(s),
			label: getStatusLabel(s),
		}));
		expect(result).toMatchSnapshot();
	});
});
