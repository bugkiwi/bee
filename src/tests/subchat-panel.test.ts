/**
 * Tests for SubChatPanel scrollable log area logic.
 *
 * We test the pure computeVisibleWindow helper directly —
 * no Ink rendering required.
 */

import { describe, expect, it } from "bun:test";
import {
	MAX_LOG_LINES,
	computeVisibleWindow,
} from "../components/SubChatPanel/SubChatPanel.tsx";

describe("computeVisibleWindow", () => {
	it("returns [0, 0] for empty log", () => {
		expect(computeVisibleWindow(0, MAX_LOG_LINES, 0)).toEqual([0, 0]);
	});

	it("returns [0, n] when fewer lines than window size", () => {
		expect(computeVisibleWindow(5, MAX_LOG_LINES, 0)).toEqual([0, 5]);
	});

	it("pins to the bottom when scrollOffset is 0", () => {
		const total = 50;
		const [start, end] = computeVisibleWindow(total, MAX_LOG_LINES, 0);
		expect(end).toBe(total);
		expect(end - start).toBe(MAX_LOG_LINES);
	});

	it("shows exactly MAX_LOG_LINES when total equals window size", () => {
		const [start, end] = computeVisibleWindow(MAX_LOG_LINES, MAX_LOG_LINES, 0);
		expect(start).toBe(0);
		expect(end).toBe(MAX_LOG_LINES);
	});

	it("auto-scroll: each new line advances the end index", () => {
		const [, end1] = computeVisibleWindow(30, MAX_LOG_LINES, 0);
		const [, end2] = computeVisibleWindow(31, MAX_LOG_LINES, 0);
		expect(end2).toBe(end1 + 1);
	});

	it("scrolling up moves window toward the head of the array", () => {
		const total = 40;
		const [, end0] = computeVisibleWindow(total, MAX_LOG_LINES, 0);
		const [, end5] = computeVisibleWindow(total, MAX_LOG_LINES, 5);
		expect(end5).toBe(end0 - 5);
	});

	it("clamps start to 0 when scrolled beyond the beginning", () => {
		const [start] = computeVisibleWindow(5, MAX_LOG_LINES, 100);
		expect(start).toBe(0);
	});

	it("clamps end to 0 when scrollOffset exceeds totalLines", () => {
		const [start, end] = computeVisibleWindow(3, MAX_LOG_LINES, 100);
		expect(start).toBe(0);
		expect(end).toBe(0);
	});

	it("visible window size equals min(windowSize, available lines)", () => {
		for (const total of [0, 5, MAX_LOG_LINES, 35, 100]) {
			const [start, end] = computeVisibleWindow(total, MAX_LOG_LINES, 0);
			expect(end - start).toBe(Math.min(total, MAX_LOG_LINES));
		}
	});

	it("preserves insertion order: start < end", () => {
		const [start, end] = computeVisibleWindow(50, MAX_LOG_LINES, 3);
		expect(start).toBeLessThan(end);
	});
});
