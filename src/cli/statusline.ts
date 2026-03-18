// ─── StatusLine: priority-based status message manager ────────────────────────
// Higher priority wins. When a priority is cleared, the next highest shows.
// No terminal I/O here — pure logic.

export const STATUS_PRIORITY = {
  BASE:      0,   // provider · model · N msgs  (always set)
  MULTILINE: 5,   // ↵ N lines buffered via Alt+Enter
  CLIPBOARD: 10,  // 📋 Image in clipboard · Ctrl+V to paste
  WORKING:   20,  // 🐝 thinking…  (set by ChatSession)
} as const;

export type StatusPriority = (typeof STATUS_PRIORITY)[keyof typeof STATUS_PRIORITY];

export class StatusLine {
  private _layers = new Map<number, string>();

  /** Set or update a message at the given priority. */
  set(priority: number, message: string): void {
    this._layers.set(priority, message);
  }

  /** Remove the message at the given priority. */
  clear(priority: number): void {
    this._layers.delete(priority);
  }

  /** Return the highest-priority message, or "" if nothing is set. */
  render(): string {
    if (this._layers.size === 0) return "";
    const max = Math.max(...this._layers.keys());
    return this._layers.get(max) ?? "";
  }

  /** Highest priority currently set (-1 if empty). */
  get highestPriority(): number {
    if (this._layers.size === 0) return -1;
    return Math.max(...this._layers.keys());
  }
}
