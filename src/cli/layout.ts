import chalk from "chalk";
import type { StatusLine } from "./statusline.ts";

/**
 * ReplLayout — 3-row fixed bottom with content cursor tracking.
 *
 * Terminal layout:
 *
 *   ┌──────────────────────────────────────────┐  rows 1 .. rows-3  (scroll region)
 *   │  banner                                  │
 *   │  › previous input  (gray)                │
 *   │  AI response                             │
 *   │  (content cursor here)                   │
 *   ├──────────────────────────────────────────┤  row rows-2  (separator, fixed)
 *   🐝 › [readline input — always here]         row rows-1  (prompt,    fixed)
 *     claude · default · 3 msgs                 row rows    (status,    fixed)
 *
 * DECSTBM keeps bottom 3 rows fixed.  Content streams in the scroll region.
 * The prompt is always at rows-1 — it never scrolls away.
 *
 * The layout tracks _contentRow so it can position the cursor in the scroll
 * region for content writes (submitted lines, AI responses) and return it to
 * the prompt row afterwards.
 */
export class ReplLayout {
  private _status: StatusLine;
  private _active = false;
  private _contentRow = 1;

  constructor(status: StatusLine) {
    this._status = status;
  }

  get contentRow(): number { return this._contentRow; }

  /**
   * Initialize: set DECSTBM, draw fixed bottom rows.
   * Call BEFORE the banner so all initial output lands in the scroll region.
   */
  init(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;

    if (rows < 8) return; // terminal too small for 3-row reservation

    // Clear screen, then reserve bottom 3 rows (separator + prompt + status)
    process.stdout.write("\x1b[2J");
    process.stdout.write(`\x1b[1;${rows - 3}r`);

    // Draw fixed rows, then position cursor at top-left of scroll region.
    // IMPORTANT: do NOT use \x1b7/\x1b8 (DEC save/restore) here — at program
    // start the saved cursor position is the shell prompt (bottom of screen),
    // restoring it puts the cursor in the fixed area, making it invisible.
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b[1;1H");

    this._active = true;
    this._contentRow = 1;
    process.stdout.on("resize", () => this._onResize());
  }

  /** Reset DECSTBM to full screen. Call on exit. */
  cleanup(): void {
    this._active = false;
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[r");
  }

  // ── Cursor positioning ───────────────────────────────────────────────────

  /**
   * Move cursor into the content (scroll) area at the tracked content row.
   * Call before writing content (submitted lines, AI output).
   */
  enterContent(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    const max = rows - 3;
    if (this._contentRow > max) this._contentRow = max;
    process.stdout.write(`\x1b[${this._contentRow};1H`);
  }

  /**
   * Move cursor to the prompt row (rows-1) and clear it.
   * Call before iface.prompt().
   */
  enterPrompt(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K`);
  }

  /**
   * Advance the content row counter by `n` newlines.
   * Capped at the bottom of the scroll region (rows-3).
   */
  advanceContent(n: number): void {
    const rows = process.stdout.rows ?? 24;
    const max = rows - 3;
    this._contentRow = Math.min(this._contentRow + n, max);
  }

  /**
   * Update the status row in-place.
   * Safe to call at any time — cursor is saved/restored.
   */
  refreshStatus(): void {
    if (!this._active || !process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    process.stdout.write("\x1b7");
    process.stdout.write(
      `\x1b[${rows};1H\x1b[2K${chalk.dim("  " + this._status.render())}`
    );
    process.stdout.write("\x1b8");
  }

  /**
   * Wrap a function so that all process.stdout.write calls during its
   * execution are counted for content-row tracking.  Returns the number
   * of newlines written.
   */
  async trackWrites(fn: () => Promise<void>): Promise<number> {
    if (!process.stdout.isTTY) {
      await fn();
      return 0;
    }
    const origWrite = process.stdout.write.bind(process.stdout);
    let nlCount = 0;
    (process.stdout as unknown as { write: typeof process.stdout.write }).write =
      function (chunk: unknown, ...rest: unknown[]): boolean {
        if (typeof chunk === "string") {
          nlCount += (chunk.match(/\n/g) || []).length;
        } else if (Buffer.isBuffer(chunk)) {
          nlCount += (chunk.toString().match(/\n/g) || []).length;
        }
        return (origWrite as Function)(chunk, ...rest);
      } as typeof process.stdout.write;
    try {
      await fn();
    } finally {
      (process.stdout as unknown as { write: typeof process.stdout.write }).write = origWrite;
    }
    return nlCount;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _drawFixed(rows: number, cols: number): void {
    const width = Math.min(cols, 120);
    // Row rows-2: separator
    process.stdout.write(
      `\x1b[${rows - 2};1H\x1b[2K${chalk.dim("─".repeat(width))}`
    );
    // Row rows-1: prompt area (cleared, prompt drawn by showPrompt)
    process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K`);
    // Row rows: status
    process.stdout.write(
      `\x1b[${rows};1H\x1b[2K${chalk.dim("  " + this._status.render())}`
    );
  }

  private _onResize(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    // Update scroll region for new size
    process.stdout.write(`\x1b[1;${rows - 3}r`);
    // Redraw fixed rows
    process.stdout.write("\x1b7");
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b8");
    // Clamp content row
    const max = rows - 3;
    if (this._contentRow > max) this._contentRow = max;
  }
}
