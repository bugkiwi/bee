import type { TerminalExtractResult } from "./types.ts";
import type { WriteStream } from "node:tty";

export const LEGACY_MOUSE_MODE_RESET = "\u001b[?1000l\u001b[?1006l";
export const ALTERNATE_SCROLL_MODE_ENABLE = "\u001b[?1007h";
export const ALTERNATE_SCROLL_MODE_DISABLE = "\u001b[?1007l";

export function writeTerminalControl(sequence: string): void {
  const target = process.stderr.isTTY ? process.stderr : process.stdout;
  target.write(sequence);
}

export function clearTerminalScreen(target: WriteStream = process.stdout): void {
  target.write("\u001b[2J\u001b[H");
}

export function enterAlternateScreen(target: WriteStream = process.stdout): void {
  target.write("\u001b[?1049h\u001b[H");
}

export function exitAlternateScreen(target: WriteStream = process.stdout): void {
  target.write("\u001b[?1049l");
}

export function restoreTerminalAfterCrash(): void {
  const target = (process.stderr.isTTY ? process.stderr : process.stdout) as WriteStream;
  try {
    if (
      process.stdin.isTTY &&
      typeof (process.stdin as NodeJS.ReadStream).setRawMode === "function"
    ) {
      (process.stdin as NodeJS.ReadStream).setRawMode(false);
    }
  } catch {
    // best-effort
  }
  try {
    target.write(`${LEGACY_MOUSE_MODE_RESET}${ALTERNATE_SCROLL_MODE_DISABLE}\u001b[?25h\u001b[0m`);
    exitAlternateScreen(target);
    target.write("\n");
  } catch {
    // best-effort
  }
}

export function sanitizeTerminalInputChunk(
  data: string,
  remainder = "",
  interceptCtrlV = false,
): {
  clean: string;
  remainder: string;
  interceptedCtrlV: boolean;
} {
  const extracted = extractTerminalEvents(data, remainder);
  const clean = interceptCtrlV ? extracted.clean.replaceAll("\x16", "") : extracted.clean;
  return {
    clean,
    remainder: extracted.remainder,
    interceptedCtrlV: interceptCtrlV && extracted.clean.includes("\x16"),
  };
}

export function extractTerminalEvents(data: string, remainder = ""): TerminalExtractResult {
  const input = remainder + data;
  const clicks: TerminalExtractResult["clicks"] = [];
  const scrolls: TerminalExtractResult["scrolls"] = [];
  const cursorReports: TerminalExtractResult["cursorReports"] = [];
  const cleanParts: string[] = [];
  let i = 0;

  while (i < input.length) {
    const escIndex = input.indexOf("\x1b", i);
    if (escIndex === -1) {
      cleanParts.push(input.slice(i));
      i = input.length;
      break;
    }

    cleanParts.push(input.slice(i, escIndex));
    const rest = input.slice(escIndex);

    const mouseMatch = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(rest);
    if (mouseMatch) {
      i = escIndex + mouseMatch[0].length;
      const rawCode = Number.parseInt(mouseMatch[1] ?? "", 10);
      const x = Number.parseInt(mouseMatch[2] ?? "", 10);
      const y = Number.parseInt(mouseMatch[3] ?? "", 10);
      const suffix = mouseMatch[4] ?? "";

      if (Number.isFinite(rawCode) && Number.isFinite(x) && Number.isFinite(y) && suffix === "M") {
        const isMotion = (rawCode & 32) !== 0;
        const isWheel = (rawCode & 64) !== 0;
        const button = rawCode & 3;
        if (!isMotion && !isWheel && button === 0) {
          clicks.push({
            x,
            y,
            shift: (rawCode & 4) !== 0,
            meta: (rawCode & 8) !== 0,
            ctrl: (rawCode & 16) !== 0,
          });
        } else if (!isMotion && isWheel) {
          scrolls.push({
            x,
            y,
            direction: button === 0 ? "up" : "down",
            ctrl: (rawCode & 16) !== 0,
            shift: (rawCode & 4) !== 0,
          });
        }
      }
      continue;
    }

    const cursorMatch = /^\x1b\[(\d+);(\d+)R/.exec(rest);
    if (cursorMatch) {
      i = escIndex + cursorMatch[0].length;
      const row = Number.parseInt(cursorMatch[1] ?? "", 10);
      const col = Number.parseInt(cursorMatch[2] ?? "", 10);
      if (Number.isFinite(row) && Number.isFinite(col)) {
        cursorReports.push({ row, col });
      }
      continue;
    }

    const isMousePartial = /^\x1b\[<[\d;]*$/.test(rest);
    const isCursorPartial = /^\x1b\[\d*(?:;\d*)?$/.test(rest);
    if (isMousePartial || isCursorPartial) {
      return {
        clean: cleanParts.join(""),
        clicks,
        scrolls,
        cursorReports,
        remainder: rest,
      };
    }

    cleanParts.push("\x1b");
    i = escIndex + 1;
  }

  return {
    clean: cleanParts.join(""),
    clicks,
    scrolls,
    cursorReports,
    remainder: "",
  };
}
