import { Box, Text } from "ink";

// ─── Pure helpers (exported for testing) ──────────────────────────────────────

export const BAR_WIDTH = 20;
export const FILLED_CHAR = "█";
export const EMPTY_CHAR = "░";

/** Returns 0–100. Returns 0 when total is 0 (no division-by-zero). */
export function calcPercent(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/** Returns the color string for a given percentage. */
export function barColor(percent: number): string {
  return percent >= 100 ? "green" : "blue";
}

/** Renders the bar string at a fixed width. */
export function renderBar(
  completed: number,
  total: number,
  width = BAR_WIDTH
): string {
  const pct = calcPercent(completed, total);
  const filled = Math.round((pct / 100) * width);
  return FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(width - filled);
}

// ─── ProgressBar component ────────────────────────────────────────────────────

interface ProgressBarProps {
  completed: number;
  total: number;
}

export function ProgressBar({ completed, total }: ProgressBarProps) {
  const pct = calcPercent(completed, total);
  const color = barColor(pct);
  const bar = renderBar(completed, total);

  return (
    <Box>
      <Text color={color}>{bar}</Text>
      <Text color="gray"> {pct}%</Text>
    </Box>
  );
}
