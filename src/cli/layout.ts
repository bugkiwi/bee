import chalk from "chalk";
import type { StatusLine } from "./statusline.ts";

/**
 * ReplLayout: manages a permanent 2-row fixed bottom for separator + status.
 *
 * Terminal layout:
 *
 *   ┌──────────────────────────────────────────┐  rows 1 .. rows-2  (scroll region)
 *   │  banner                                  │
 *   │  › previous user input  (gray, no bee)   │
 *   │  AI response                             │
 *   │  🐝 › [readline prompt — moves naturally]│
 *   ├──────────────────────────────────────────┤  row rows-1  (separator, fixed)
 *     claude · default · 3 msgs                 row rows    (status,    fixed)
 *
 * DECSTBM keeps bottom 2 rows permanently fixed.
 * All content — banner, history, responses, readline — lives in the scroll
 * region.  When the region fills up, content scrolls up naturally.  The
 * prompt therefore starts near the top on a fresh session and drifts to the
 * bottom as conversation grows, exactly what the user expects.
 *
 * \x1b7 / \x1b8 (DEC save/restore cursor) are only used here to update the
 * fixed rows without disturbing the cursor.  There is no scrolling while the
 * save/restore is in flight, so the row numbers never drift — the historic
 * corruption bug cannot occur.
 */
export class ReplLayout {
  private _status: StatusLine;
  private _active = false;

  constructor(status: StatusLine) {
    this._status = status;
  }

  /**
   * Initialize: set DECSTBM scroll region and draw the fixed bottom rows.
   * Call once after the banner is printed, before the first prompt.
   */
  init(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;

    // Reserve bottom 2 rows for separator + status
    process.stdout.write(`\x1b[1;${rows - 2}r`);

    // Draw separator + status without disturbing the cursor (banner position kept)
    process.stdout.write("\x1b7");
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b8");

    this._active = true;
    process.stdout.on("resize", () => this._onResize());
  }

  /** Reset DECSTBM to full screen. Call on exit so the shell is clean. */
  cleanup(): void {
    this._active = false;
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[r");
  }

  /**
   * Update the status row in-place.
   * Safe to call at any time — during typing, streaming, idle, etc.
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

  // ── Private helpers ────────────────────────────────────────────────────────

  private _drawFixed(rows: number, cols: number): void {
    const width = Math.min(cols, 120);
    // Row rows-1: separator line
    process.stdout.write(
      `\x1b[${rows - 1};1H\x1b[2K${chalk.dim("─".repeat(width))}`
    );
    // Row rows: status text
    process.stdout.write(
      `\x1b[${rows};1H\x1b[2K${chalk.dim("  " + this._status.render())}`
    );
  }

  private _onResize(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    process.stdout.write(`\x1b[1;${rows - 2}r`);
    process.stdout.write("\x1b7");
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b8");
  }
}
