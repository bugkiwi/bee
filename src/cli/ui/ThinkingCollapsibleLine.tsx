import { useEffect, useMemo, useState } from "react";
import { Box, Text, useFocus, useInput, useStdout } from "ink";
import { isCollapsibleThinkingLine, summarizeThinking } from "./content.ts";
import type { ContentLine } from "./types.ts";

interface ThinkingCollapsibleLineProps {
  groupId: string;
  lines: ContentLine[];
  expanded: boolean;
  isActive: boolean;
  isStreaming: boolean;
  onToggle: () => void;
  onFocusChange: (focused: boolean) => void;
}

const THINKING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function ThinkingCollapsibleLine({
  groupId,
  lines,
  expanded,
  isActive,
  isStreaming,
  onToggle,
  onFocusChange,
}: ThinkingCollapsibleLineProps) {
  const { stdout } = useStdout();
  const panelWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const summarySource = useMemo(() => {
    const firstContent = lines.find((line) => line.type === "thinking" && isCollapsibleThinkingLine(line.text));
    return firstContent ?? lines[0];
  }, [lines]);
  const summaryLineText = summarySource?.text ?? "";
  const { summary, full, truncated } = useMemo(() => summarizeThinking(summaryLineText), [summaryLineText]);

  const { isFocused } = useFocus({
    id: `thinking-${groupId}`,
    isActive,
  });

  useEffect(() => {
    onFocusChange(isFocused);
  }, [isFocused, onFocusChange]);

  useEffect(() => {
    if (!isStreaming) {
      setSpinnerIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setSpinnerIndex((prev) => (prev + 1) % THINKING_SPINNER_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, [isStreaming]);

  useInput((input, key) => {
    if (!isActive || !isFocused) return;
    if (key.return || input === " ") {
      onToggle();
    }
  }, { isActive: isActive && isFocused });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? "yellow" : "gray"}
      paddingX={1}
      width={panelWidth}
    >
      <Text color={isFocused ? "white" : "gray"} wrap="truncate-end">
        {`${expanded ? "▼" : "▶"} ${isStreaming ? `${THINKING_SPINNER_FRAMES[spinnerIndex]} ` : ""}${summary}`}
      </Text>
      {expanded ? (
        <Box flexDirection="column">
          {truncated ? <Text dimColor>{full}</Text> : null}
          {lines
            .filter((line) => line.id !== summarySource?.id)
            .map((line) => (
              <Text
                key={line.id}
                color={line.type === "tool" ? "cyan" : "gray"}
                dimColor={line.type !== "tool"}
              >
                {line.text.trimStart()}
              </Text>
            ))}
        </Box>
      ) : null}
    </Box>
  );
}
