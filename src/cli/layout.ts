import chalk from "chalk";
import type { StatusLine } from "./statusline.ts";

/**
 * ReplLayout — 3-row fixed bottom with cursor save/restore.
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
 * Cursor tracking uses TWO independent save/restore slots:
 *   - SCO  (\x1b[s / \x1b[u) — saves/restores the content cursor position
 *   - DEC  (\x1b7  / \x1b8)  — saves/restores during status-row refresh
 * This way refreshStatus() can run mid-stream without corrupting the
 * content cursor, and enterContent()/leaveContent() always returns to
 * the exact byte where content left off.
 */
export class ReplLayout {
  private _status: StatusLine;
  private _active = false;

  constructor(status: StatusLine) {
    this._status = status;
  }

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
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b[1;1H");

    // Save the initial content cursor position in the SCO slot
    process.stdout.write("\x1b[s");

    this._active = true;
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
   * Restore the content cursor position (SCO restore) and continue writing
   * in the scroll region.  Call before writing content.
   */
  enterContent(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[u");
  }

  /**
   * Move cursor to the prompt row (rows-1) and clear it.
   * Does NOT save the content cursor — call saveContent() explicitly
   * after content writes, before calling enterPrompt().
   */
  enterPrompt(): void {
    if (!process.stdout.isTTY) return;
    const rows = process.stdout.rows ?? 24;
    process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K`);
  }

  /**
   * Save the content cursor without leaving the content area.
   * Call after finishing a batch of content writes (e.g. after AI response)
   * so the next enterContent() returns to the right spot.
   */
  saveContent(): void {
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[s");
  }

  /**
   * Update the status row in-place.
   * Safe to call at any time — uses DEC save/restore (\x1b7/\x1b8),
   * independent of the SCO content cursor slot.
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
    // Redraw fixed rows using DEC save/restore (won't affect content cursor)
    process.stdout.write("\x1b7");
    this._drawFixed(rows, cols);
    process.stdout.write("\x1b8");
  }
}
