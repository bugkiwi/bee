import stringWidth from "string-width";
import { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { toInlineSummaryText } from "./content.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type StatusPhase = "thinking" | "tool" | "responding";

const PHASE_CONFIG: Record<StatusPhase, { badge: string; color: string }> = {
  thinking: { badge: "THINKING", color: "magenta" },
  tool: { badge: "TOOL", color: "cyan" },
  responding: { badge: "WRITING", color: "green" },
};

export interface StatusBarProps {
  phase: StatusPhase;
  label: string;
  terminalWidth: number;
}

function truncateToWidth(text: string, width: number): string {
  if (width <= 0 || text.length === 0) return "";
  if (stringWidth(text) <= width) return text;
  if (width === 1) return "…";

  let truncated = "";
  for (const char of text) {
    if (stringWidth(truncated) + stringWidth(char) > width - 1) break;
    truncated += char;
  }
  return `${truncated}…`;
}

export function StatusBar({ phase, label, terminalWidth }: StatusBarProps) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const phaseRef = useRef(phase);

  // Reset elapsed when phase changes
  if (phaseRef.current !== phase) {
    phaseRef.current = phase;
    startRef.current = Date.now();
  }

  useEffect(() => {
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 90);
    return () => clearInterval(t);
  }, []);

  const { badge, color } = PHASE_CONFIG[phase];
  const spinner = SPINNER_FRAMES[frame]!;
  const elapsedStr = elapsed > 0 ? `${elapsed}s` : "";
  const inlineLabel = toInlineSummaryText(label);

  // Layout:  ── ⠋ BADGE · label text ──────────────────── 4s ──
  // Fixed parts: "── " (3) + spinner (1) + " " (1) + badge + " · " (3) + " " + elapsed + " ──" (3)
  const fixedLen = (
    3 + 1 + 1 + stringWidth(badge) +
    (inlineLabel ? 3 : 0) +
    (elapsedStr ? 1 + stringWidth(elapsedStr) : 0) +
    3
  );
  const availableForLabel = Math.max(0, terminalWidth - fixedLen - 4); // 4 extra for fill dashes
  const truncatedLabel = truncateToWidth(inlineLabel, availableForLabel);

  // Right fill: dashes between content and elapsed
  const contentLen = 3 + 1 + 1 + stringWidth(badge) + (truncatedLabel ? 3 + stringWidth(truncatedLabel) : 0);
  const rightLen = (elapsedStr ? 1 + stringWidth(elapsedStr) : 0) + 3;
  const fillLen = Math.max(1, terminalWidth - contentLen - rightLen);
  const fill = "─".repeat(fillLen);

  return (
    <Box flexDirection="column" width={terminalWidth}>
      {/* Status row */}
      <Box>
        {/* Left anchor */}
        <Text dimColor>{"── "}</Text>

        {/* Spinner + phase badge */}
        <Text color={color as Parameters<typeof Text>[0]["color"]}>
          {spinner}
          {" "}
          {badge}
        </Text>

        {/* Label */}
        {truncatedLabel ? (
          <Text dimColor>{" · "}{truncatedLabel}</Text>
        ) : null}

        {/* Dynamic fill */}
        <Text dimColor>{fill}</Text>

        {/* Elapsed + right anchor */}
        {elapsedStr ? (
          <Text dimColor>{" "}{elapsedStr}</Text>
        ) : null}
        <Text dimColor>{" ──"}</Text>
      </Box>
    </Box>
  );
}
