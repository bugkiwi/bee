/**
 * Tests for ProgressBar pure helper functions.
 */

import { describe, it, expect } from "bun:test";
import {
  calcPercent,
  barColor,
  renderBar,
  BAR_WIDTH,
  FILLED_CHAR,
  EMPTY_CHAR,
} from "../components/ProgressBar.tsx";

// ─── calcPercent ──────────────────────────────────────────────────────────────

describe("calcPercent", () => {
  it("returns 0 when total is 0 (no division-by-zero)", () => {
    expect(calcPercent(0, 0)).toBe(0);
  });

  it("returns 0 when completed is 0", () => {
    expect(calcPercent(0, 5)).toBe(0);
  });

  it("returns 100 when completed equals total", () => {
    expect(calcPercent(5, 5)).toBe(100);
  });

  it("returns 50 for half completion", () => {
    expect(calcPercent(1, 2)).toBe(50);
  });

  it("rounds to nearest integer", () => {
    expect(calcPercent(1, 3)).toBe(33);
    expect(calcPercent(2, 3)).toBe(67);
  });
});

// ─── barColor ─────────────────────────────────────────────────────────────────

describe("barColor", () => {
  it("returns green at 100%", () => {
    expect(barColor(100)).toBe("green");
  });

  it("returns blue below 100%", () => {
    expect(barColor(0)).toBe("blue");
    expect(barColor(50)).toBe("blue");
    expect(barColor(99)).toBe("blue");
  });
});

// ─── renderBar ────────────────────────────────────────────────────────────────

describe("renderBar", () => {
  it("renders an empty bar when total is 0", () => {
    const bar = renderBar(0, 0);
    expect(bar).toBe(EMPTY_CHAR.repeat(BAR_WIDTH));
    expect(bar).not.toContain(FILLED_CHAR);
  });

  it("renders a fully filled bar at 100%", () => {
    const bar = renderBar(5, 5);
    expect(bar).toBe(FILLED_CHAR.repeat(BAR_WIDTH));
    expect(bar).not.toContain(EMPTY_CHAR);
  });

  it("renders a half-filled bar at 50%", () => {
    const bar = renderBar(1, 2);
    const half = BAR_WIDTH / 2;
    expect(bar).toBe(FILLED_CHAR.repeat(half) + EMPTY_CHAR.repeat(half));
  });

  it("renders an empty bar at 0%", () => {
    const bar = renderBar(0, 10);
    expect(bar).toBe(EMPTY_CHAR.repeat(BAR_WIDTH));
  });

  it("total bar length equals BAR_WIDTH", () => {
    expect([...renderBar(3, 7)].length).toBe(BAR_WIDTH);
    expect([...renderBar(0, 0)].length).toBe(BAR_WIDTH);
    expect([...renderBar(10, 10)].length).toBe(BAR_WIDTH);
  });

  it("respects custom width", () => {
    const bar = renderBar(1, 2, 10);
    expect([...bar].length).toBe(10);
    expect(bar).toBe(FILLED_CHAR.repeat(5) + EMPTY_CHAR.repeat(5));
  });
});

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("ProgressBar snapshots", () => {
  it("renderBar output matches snapshot at key percentages", () => {
    const result = {
      "0%": renderBar(0, 10),
      "25%": renderBar(1, 4),
      "50%": renderBar(1, 2),
      "75%": renderBar(3, 4),
      "100%": renderBar(10, 10),
      "0/0": renderBar(0, 0),
    };
    expect(result).toMatchSnapshot();
  });

  it("barColor output matches snapshot", () => {
    expect({ at0: barColor(0), at50: barColor(50), at99: barColor(99), at100: barColor(100) }).toMatchSnapshot();
  });

  it("calcPercent output matches snapshot for representative inputs", () => {
    expect({
      "0/0": calcPercent(0, 0),
      "0/5": calcPercent(0, 5),
      "1/3": calcPercent(1, 3),
      "2/3": calcPercent(2, 3),
      "5/5": calcPercent(5, 5),
    }).toMatchSnapshot();
  });
});
