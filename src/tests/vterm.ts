/**
 * VirtualTerminal — minimal VT100/xterm state machine for testing.
 *
 * Processes ANSI escape sequences and maintains:
 *   - Screen buffer (rows × cols)
 *   - Cursor position (row, col) — 1-based like real terminals
 *   - Scroll region (DECSTBM margins)
 *   - Two independent cursor save slots: SCO (\x1b[s/\x1b[u) and DEC (\x1b7/\x1b8)
 *
 * This lets tests verify that content is written inside the scroll region,
 * cursor save/restore works correctly, and no writes go to fixed rows.
 */

export interface CursorPos {
  row: number;
  col: number;
}

export class VirtualTerminal {
  readonly rows: number;
  readonly cols: number;

  /** Screen buffer: screen[row][col] = character. 0-indexed internally. */
  private screen: string[][];

  /** Cursor position, 1-based (matching terminal convention). */
  cursorRow = 1;
  cursorCol = 1;

  /** DECSTBM scroll region, 1-based inclusive. Default = full screen. */
  scrollTop = 1;
  scrollBottom: number;

  /** SCO cursor save slot (\x1b[s / \x1b[u). */
  private _scoSave: CursorPos = { row: 1, col: 1 };
  /** DEC cursor save slot (\x1b7 / \x1b8). */
  private _decSave: CursorPos = { row: 1, col: 1 };

  /** Log of all content writes with their cursor position at time of write. */
  writeLog: Array<{ row: number; col: number; text: string }> = [];

  constructor(rows = 24, cols = 80) {
    this.rows = rows;
    this.cols = cols;
    this.scrollBottom = rows;
    this.screen = Array.from({ length: rows }, () => Array(cols).fill(" "));
  }

  /** Feed a string (containing text + escape sequences) through the terminal. */
  feed(input: string): void {
    let i = 0;
    while (i < input.length) {
      if (input[i] === "\x1b") {
        // Escape sequence
        const consumed = this._parseEscape(input, i);
        if (consumed > 0) {
          i += consumed;
          continue;
        }
        // Unknown escape — skip the ESC char
        i++;
        continue;
      }

      if (input[i] === "\n") {
        this.cursorCol = 1; // newline resets column (like real terminals)
        this._linefeed();
        i++;
        continue;
      }

      if (input[i] === "\r") {
        this.cursorCol = 1;
        i++;
        continue;
      }

      // Regular character — write to screen
      if (this.cursorRow >= 1 && this.cursorRow <= this.rows &&
          this.cursorCol >= 1 && this.cursorCol <= this.cols) {
        this.screen[this.cursorRow - 1]![this.cursorCol - 1] = input[i]!;
        this.writeLog.push({ row: this.cursorRow, col: this.cursorCol, text: input[i]! });
      }
      this.cursorCol++;
      if (this.cursorCol > this.cols) {
        // Line wrap
        this.cursorCol = 1;
        this._linefeed();
      }
      i++;
    }
  }

  /** Get the visible text on a row (1-based), trimmed of trailing spaces. */
  getRow(row: number): string {
    if (row < 1 || row > this.rows) return "";
    return this.screen[row - 1]!.join("").trimEnd();
  }

  /** Check if cursor is inside the scroll region. */
  isCursorInScrollRegion(): boolean {
    return this.cursorRow >= this.scrollTop && this.cursorRow <= this.scrollBottom;
  }

  /** Check if a given row is inside the scroll region. */
  isRowInScrollRegion(row: number): boolean {
    return row >= this.scrollTop && row <= this.scrollBottom;
  }

  /** Get the SCO saved cursor position. */
  get scoSavedPos(): CursorPos { return { ...this._scoSave }; }

  /** Get the DEC saved cursor position. */
  get decSavedPos(): CursorPos { return { ...this._decSave }; }

  /** Get all rows in the scroll region that have non-empty content. */
  getContentRows(): Array<{ row: number; text: string }> {
    const result: Array<{ row: number; text: string }> = [];
    for (let r = this.scrollTop; r <= this.scrollBottom; r++) {
      const text = this.getRow(r);
      if (text) result.push({ row: r, text });
    }
    return result;
  }

  /** Check if any writes went to rows outside the scroll region. */
  hasWritesOutsideScrollRegion(): boolean {
    return this.writeLog.some(
      w => w.row < this.scrollTop || w.row > this.scrollBottom
    );
  }

  /** Get writes that went outside the scroll region. */
  getWritesOutsideScrollRegion(): Array<{ row: number; col: number; text: string }> {
    return this.writeLog.filter(
      w => w.row < this.scrollTop || w.row > this.scrollBottom
    );
  }

  // ── Private: escape sequence parser ──────────────────────────────────────

  /** Parse an escape sequence starting at position i. Returns chars consumed. */
  private _parseEscape(input: string, i: number): number {
    if (i + 1 >= input.length) return 0;

    const next = input[i + 1];

    // DEC save cursor: \x1b7
    if (next === "7") {
      this._decSave = { row: this.cursorRow, col: this.cursorCol };
      return 2;
    }

    // DEC restore cursor: \x1b8
    if (next === "8") {
      this.cursorRow = this._decSave.row;
      this.cursorCol = this._decSave.col;
      return 2;
    }

    // CSI sequence: \x1b[...
    if (next === "[") {
      return this._parseCSI(input, i);
    }

    return 0;
  }

  /** Parse a CSI sequence \x1b[...X. Returns total chars consumed. */
  private _parseCSI(input: string, start: number): number {
    // start points to \x1b, start+1 is [
    let i = start + 2;
    let params = "";

    // Collect parameter bytes (digits and ;)
    while (i < input.length && ((input[i]! >= "0" && input[i]! <= "9") || input[i] === ";")) {
      params += input[i];
      i++;
    }

    if (i >= input.length) return 0; // incomplete sequence

    const finalByte = input[i]!;
    const consumed = i - start + 1;
    const parts = params ? params.split(";").map(Number) : [];

    switch (finalByte) {
      case "H": // CUP — Cursor Position: \x1b[row;colH
      case "f": // HVP — same as CUP
        this.cursorRow = parts[0] || 1;
        this.cursorCol = parts[1] || 1;
        break;

      case "A": // CUU — Cursor Up
        this.cursorRow = Math.max(this.scrollTop, this.cursorRow - (parts[0] || 1));
        break;

      case "B": // CUD — Cursor Down
        this.cursorRow = Math.min(this.scrollBottom, this.cursorRow + (parts[0] || 1));
        break;

      case "C": // CUF — Cursor Forward
        this.cursorCol = Math.min(this.cols, this.cursorCol + (parts[0] || 1));
        break;

      case "D": // CUB — Cursor Back
        this.cursorCol = Math.max(1, this.cursorCol - (parts[0] || 1));
        break;

      case "G": // CHA — Cursor Character Absolute (move to column)
        this.cursorCol = parts[0] || 1;
        break;

      case "J": // ED — Erase in Display
        this._eraseDisplay(parts[0] || 0);
        break;

      case "K": // EL — Erase in Line
        this._eraseLine(parts[0] || 0);
        break;

      case "r": // DECSTBM — Set Scroll Region
        if (parts.length >= 2) {
          this.scrollTop = parts[0] || 1;
          this.scrollBottom = parts[1] || this.rows;
        } else {
          // \x1b[r with no params resets to full screen
          this.scrollTop = 1;
          this.scrollBottom = this.rows;
        }
        // DECSTBM moves cursor to home position
        this.cursorRow = 1;
        this.cursorCol = 1;
        break;

      case "s": // SCO Save Cursor Position
        this._scoSave = { row: this.cursorRow, col: this.cursorCol };
        break;

      case "u": // SCO Restore Cursor Position
        this.cursorRow = this._scoSave.row;
        this.cursorCol = this._scoSave.col;
        break;

      case "m": // SGR — Select Graphic Rendition (colors etc.) — ignore
        break;

      default:
        // Unknown CSI sequence — ignore
        break;
    }

    return consumed;
  }

  // ── Private: terminal operations ─────────────────────────────────────────

  private _linefeed(): void {
    if (this.cursorRow === this.scrollBottom) {
      // At bottom margin: scroll content up within the scroll region
      this._scrollUp();
    } else if (this.cursorRow < this.rows) {
      this.cursorRow++;
    }
  }

  /** Scroll the content within the scroll region up by one line. */
  private _scrollUp(): void {
    // Move each row up, blank the bottom margin row
    for (let r = this.scrollTop - 1; r < this.scrollBottom - 1; r++) {
      this.screen[r] = this.screen[r + 1]!.slice();
    }
    this.screen[this.scrollBottom - 1] = Array(this.cols).fill(" ");
  }

  private _eraseDisplay(mode: number): void {
    if (mode === 2) {
      // Clear entire screen
      this.screen = Array.from({ length: this.rows }, () => Array(this.cols).fill(" "));
    }
    // mode 0 (below cursor) and 1 (above cursor) not fully implemented
  }

  private _eraseLine(mode: number): void {
    const r = this.cursorRow - 1;
    if (r < 0 || r >= this.rows) return;
    if (mode === 0) {
      // Clear from cursor to end of line
      for (let c = this.cursorCol - 1; c < this.cols; c++) {
        this.screen[r]![c] = " ";
      }
    } else if (mode === 1) {
      // Clear from start to cursor
      for (let c = 0; c < this.cursorCol; c++) {
        this.screen[r]![c] = " ";
      }
    } else if (mode === 2) {
      // Clear entire line
      this.screen[r] = Array(this.cols).fill(" ");
    }
  }
}
