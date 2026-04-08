import { describe, expect, it } from "bun:test";
import { renderToString } from "ink";
import { InputPanel } from "../cli/ui/InputPanel.tsx";
import { stripAnsi } from "../utils/strip-ansi.ts";

function compact(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

describe("InputPanel plan summary rendering", () => {
	it("keeps the plan hash, progress, and status together on one line", () => {
		const rendered = stripAnsi(
			renderToString(
				<InputPanel
					input=""
					inputResetKey={0}
					statusDivider="────────────────────────"
					statusInfo="kimi · default"
					suggestions={[]}
					planSummary={{
						planHash: "2cb8fb4f",
						progressLabel: "task 2/5",
						taskTitle:
							"Wire compact plan status into the input panel and verify truncation behavior in a narrow terminal",
						taskStatus: "running",
					}}
					isActive
					inputDisabled={false}
					isProcessing={false}
					canSubmit
					imageHint={false}
					onChange={() => {}}
					onSubmit={() => {}}
					onFocusChange={() => {}}
					slashOptions={[]}
					slashSelectedIndex={0}
					providerOptions={[]}
					providerSelectedIndex={0}
				/>,
				{ columns: 72 },
			),
		);
		const lines = rendered.split("\n").map(compact);

		expect(
			lines.some((line) =>
				line.includes("◇ plan 2cb8fb4f · task 2/5 · ▶ running"),
			),
		).toBe(true);
	});
});
