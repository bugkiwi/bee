import { describe, expect, it } from "bun:test";
import { renderToString } from "ink";
import {
	dequeueQueuedInput,
	enqueueQueuedInput,
	type QueuedInputItem,
} from "../cli/ui/App.tsx";
import { QueuePanel } from "../cli/ui/QueuePanel.tsx";
import { stripAnsi } from "../utils/strip-ansi.ts";

describe("input queue helpers", () => {
	it("appends queued chat items in FIFO order", () => {
		const queue = enqueueQueuedInput([], "first");
		const next = enqueueQueuedInput(queue, "second");

		expect(next.map((item) => item.text)).toEqual(["first", "second"]);
	});

	it("drains one queued item at a time", () => {
		const queue = [
			{ id: "q1", text: "first", createdAt: "2026-04-07T00:00:00.000Z" },
			{ id: "q2", text: "second", createdAt: "2026-04-07T00:00:01.000Z" },
		] satisfies QueuedInputItem[];
		const first = queue[0]!;
		const second = queue[1]!;

		expect(dequeueQueuedInput(queue)).toEqual({
			next: first,
			rest: [second],
		});
	});
});

describe("QueuePanel", () => {
	it("renders queued items and auto-run hint", () => {
		const rendered = stripAnsi(
			renderToString(
				<QueuePanel
					items={[
						{
							id: "q1",
							text: "first follow-up message",
							createdAt: "2026-04-07T00:00:00.000Z",
						},
						{
							id: "q2",
							text: "second follow-up message",
							createdAt: "2026-04-07T00:00:01.000Z",
						},
					]}
				/>,
				{ columns: 72 },
			),
		);

		expect(rendered).toContain("Queued messages");
		expect(rendered).toContain("first follow-up message");
		expect(rendered).toContain("Auto-run after current answer");
	});
});
