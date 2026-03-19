import chalk from "chalk";
import { SLASH_COMMANDS } from "./commands.ts";

// Visible columns of the prompt "🐝 › " — emoji is 2-wide + " › " = 5
const PROMPT_VISIBLE = 5; // "🐝 › "
const MAX_SUGGESTIONS = 10; // cap to avoid excessive scrolling

let _lineCount = 0; // suggestion lines currently on screen
let _inputAtShow = ""; // rl.line value when suggestions were last shown

/**
 * Clear suggestion lines below the prompt.
 * Uses relative cursor movement (\x1b[NA] = cursor up N) so it works
 * correctly even when the terminal has scrolled.
 */
export function clearSuggestions(): void {
  if (_lineCount === 0) return;

  // Move down through suggestion lines, erasing each
  for (let i = 0; i < _lineCount; i++) {
    process.stdout.write("\n\x1b[2K");
  }
  // Relative move back up
  process.stdout.write(`\x1b[${_lineCount}A`);
  // Restore column to end of input
  const col = PROMPT_VISIBLE + _inputAtShow.length + 1;
  process.stdout.write(`\x1b[${col}G`);

  _lineCount = 0;
  _inputAtShow = "";
}

/**
 * Print matching commands below the current prompt line.
 * @param partial  The current value of rl.line (e.g. "/he")
 */
export function showSuggestions(partial: string): void {
  if (!process.stdout.isTTY) return;
  clearSuggestions();

  const query = partial.startsWith("/") ? partial.slice(1) : "";
  // Exact alias match wins — e.g. "/p" → only `provider`, not also `plan`
  const exactAlias = query ? SLASH_COMMANDS.find((c) => c.alias === query) : null;
  const matches = exactAlias
    ? [exactAlias]
    : SLASH_COMMANDS.filter(
        (c) =>
          !query ||
          c.name.startsWith(query) ||
          (c.alias ?? "").startsWith(query)
      );
  if (matches.length === 0) return;

  const rows = matches.slice(0, MAX_SUGGESTIONS).map((c) => {
    const name = chalk.cyan(`/${c.name}`).padEnd(20);
    const alias = c.alias ? chalk.gray(` /${c.alias}`) : "    ";
    return `  ${name}${alias}  ${chalk.gray(c.desc)}`;
  });

  // Write suggestion lines below current line using relative movement.
  // \r resets to column 0 before each write to prevent column-drift wrapping.
  for (const row of rows) {
    process.stdout.write("\n\r\x1b[2K" + row);
  }

  // Move cursor back up (relative — works after any amount of scrolling)
  process.stdout.write(`\x1b[${rows.length}A`);
  // Restore cursor to end of current input
  const col = PROMPT_VISIBLE + partial.length + 1;
  process.stdout.write(`\x1b[${col}G`);

  _lineCount = rows.length;
  _inputAtShow = partial;
}
