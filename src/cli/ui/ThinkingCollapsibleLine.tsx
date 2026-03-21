import { useEffect, useMemo, useState } from "react";
import { Box, Text, useFocus, useInput, useStdout } from "ink";
import {
  CONTENT_LABEL_GAP,
  CONTENT_LABEL_WIDTH,
  getContentLineBlocks,
  getContentLineText,
  summarizeMetaGroup,
  type MetaGroupType,
} from "./content.ts";
import type { ContentLine } from "./types.ts";

interface ThinkingCollapsibleLineProps {
  groupId: string;
  groupType: MetaGroupType;
  lines: ContentLine[];
  expanded: boolean;
  isActive: boolean;
  isStreaming: boolean;
  onToggle: () => void;
  onFocusChange: (focused: boolean) => void;
}

const THINKING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function diffLineColor(line: string): { color?: "cyan" | "green" | "red" | "yellow" | "gray"; dim?: boolean } {
  if (line.startsWith("+++") || line.startsWith("---")) return { color: "cyan" };
  if (line.startsWith("@@")) return { color: "yellow", dim: true };
  if (line.startsWith("+")) return { color: "green" };
  if (line.startsWith("-")) return { color: "red" };
  return { color: "gray", dim: true };
}

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
  const panelWidth = Math.max(20, stdout.columns ?? 80);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const { summary, full, truncated, summarySource } = useMemo(() => summarizeMetaGroup(lines), [lines]);

  const { isFocused } = useFocus({
    id: `meta-${groupId}`,
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
    <Box flexDirection="column" width={panelWidth}>
      <Box width="100%">
        {/* empty label-column spacer for alignment with › label column */}
        <Box width={CONTENT_LABEL_WIDTH} marginRight={CONTENT_LABEL_GAP} flexShrink={0} />
        <Box flexGrow={1}>
          <Text color={isFocused ? "white" : "gray"} wrap="truncate-end">
            <Text color={isFocused ? "yellow" : "gray"}>{expanded ? "▼" : "▶"}</Text>
            {isStreaming ? <Text color={isFocused ? "yellow" : "gray"}>{` ${THINKING_SPINNER_FRAMES[spinnerIndex]}`}</Text> : null}
            <Text dimColor>{` [`}</Text>
            <Text>{summary}</Text>
            <Text dimColor>]</Text>
          </Text>
        </Box>
      </Box>
      {expanded ? (
        <Box flexDirection="column" marginTop={1}>
          {truncated ? (
            <Box width="100%">
              {/* empty label-column spacer for alignment with › label column */}
              <Box width={CONTENT_LABEL_WIDTH} marginRight={CONTENT_LABEL_GAP} flexShrink={0} />
              <Box flexGrow={1}>
                <Text color="gray" dimColor>
                  {full}
                </Text>
              </Box>
            </Box>
          ) : null}
          {lines
            .filter((line) => line.id !== summarySource?.id)
            .map((line) => (
              <Box key={line.id} width="100%">
                {/* empty label-column spacer for alignment with › label column */}
                <Box width={CONTENT_LABEL_WIDTH} marginRight={CONTENT_LABEL_GAP} flexShrink={0} />
                <Box flexGrow={1} flexDirection="column">
                  {line.meta?.kind === "tool-diff" ? (
                    <>
                      <Text color="cyan" dimColor>
                        {getContentLineText(line)}
                      </Text>
                      {getContentLineBlocks(line)
                        .slice(1)
                        .flatMap((block) => block.split("\n"))
                        .map((patchLine, index) => {
                          const style = diffLineColor(patchLine);
                          return (
                            <Text key={`${line.id}-patch-${index}`} color={style.color} dimColor={style.dim}>
                              {patchLine}
                            </Text>
                          );
                        })}
                    </>
                  ) : (
                    <Text
                      color={line.type === "tool" ? "cyan" : "gray"}
                      dimColor
                    >
                      {getContentLineText(line)}
                    </Text>
                  )}
                </Box>
              </Box>
            ))}
        </Box>
      ) : null}
    </Box>
  );
}
