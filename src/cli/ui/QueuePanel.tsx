import { Box, Text } from "ink";
import stringWidth from "string-width";
import type { QueuedInputItem } from "./App.tsx";

interface QueuePanelProps {
	items: QueuedInputItem[];
}

function truncateText(text: string, width: number): string {
	if (width <= 0 || stringWidth(text) <= width) return text;
	let output = "";
	for (const char of text) {
		if (stringWidth(`${output}${char}…`) > width) break;
		output += char;
	}
	return `${output}…`;
}

export function QueuePanel({ items }: QueuePanelProps) {
	if (items.length === 0) return null;

	const preview = items.slice(0, 3);
	const hiddenCount = items.length - preview.length;

	return (
		<Box flexDirection="column" marginTop={1} paddingLeft={1}>
			<Text color="yellow" bold>
				{`Queued messages · ${items.length} pending · Auto-run after current answer`}
			</Text>
			{preview.map((item, index) => (
				<Text key={item.id} color="gray" dimColor wrap="truncate-end">
					{`${index + 1}. ${truncateText(item.text, 96)}`}
				</Text>
			))}
			{hiddenCount > 0 ? (
				<Text color="gray" dimColor>
					{`+${hiddenCount} more`}
				</Text>
			) : null}
		</Box>
	);
}
