import { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { TaskStatus } from "../../types/task.ts";
import { StatusBadge } from "../StatusBadge.tsx";

/** Maximum number of log lines visible at once inside the scrollable viewport. */
export const MAX_LOG_LINES = 20;

/**
 * Compute the [start, end) slice indices for the visible window.
 *
 * scrollOffset = 0  → pinned to the bottom (auto-scroll)
 * scrollOffset = N  → scrolled N lines up from the bottom
 */
export function computeVisibleWindow(
  totalLines: number,
  windowSize: number,
  scrollOffset: number,
): [number, number] {
  const end = Math.max(0, totalLines - scrollOffset);
  const start = Math.max(0, end - windowSize);
  return [start, end];
}

interface SubChatPanelProps {
  taskId: string;
  title: string;
  status: TaskStatus;
  logLines: string[];
}

export function SubChatPanel({ title, status, logLines }: SubChatPanelProps) {
  // scrollOffset=0 means pinned to the bottom (auto-scroll mode)
  const [scrollOffset] = useState(0);
  // Sentinel ref — tracks whether we are in auto-scroll mode (pinned to bottom)
  const atBottomRef = useRef(true);

  // Auto-scroll: whenever a new line is appended and we are pinned to the
  // bottom, keep the visible window at the tail of the array.
  useEffect(() => {
    atBottomRef.current = scrollOffset === 0;
  }, [logLines.length, scrollOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  const [start, end] = computeVisibleWindow(logLines.length, MAX_LOG_LINES, scrollOffset);
  const visibleLines = logLines.slice(start, end);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" marginY={1}>
      {/* Header row: title left-aligned, StatusBadge right-aligned */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingX={1}
        paddingY={0}
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
      >
        <Text bold color="white">{title}</Text>
        <StatusBadge status={status} />
      </Box>
      {/* Log area: dimmed monospace-style text, constrained height, auto-scroll */}
      <Box
        flexDirection="column"
        height={MAX_LOG_LINES}
        overflowY="hidden"
        paddingX={1}
        paddingY={1}
      >
        {visibleLines.map((line, i) => (
          <Text key={start + i} color="gray" dimColor>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
