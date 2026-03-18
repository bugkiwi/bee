import chalk from "chalk";
import * as rl from "node:readline";

/**
 * Inline arrow-key selection menu.
 *
 * Uses the `keypress` event (emitted by rl.emitKeypressEvents) so it works
 * correctly alongside readline's keypress transform, which consumes raw bytes
 * before any `readable` listener can see them.
 *
 * Explicitly resumes stdin during selection (iface.pause() pauses it) and
 * pauses it again on exit so readline can resume normally.
 *
 * Returns the chosen index, or null if the user pressed Escape / Ctrl+C.
 */
export async function interactiveSelect(
  options: string[],
  initialIdx = 0,
  { hint = "" }: { hint?: string } = {}
): Promise<number | null> {
  if (!process.stdout.isTTY || options.length === 0) return initialIdx;

  let idx = Math.max(0, Math.min(initialIdx, options.length - 1));
  const hintLine = hint ? chalk.gray(`  ${hint}\n`) : "";
  const LINES = options.length + (hint ? 1 : 0);

  function render(first = false) {
    if (!first) {
      process.stdout.write(`\x1b[${LINES}A`);
    }
    if (hint) process.stdout.write(`\x1b[2K${hintLine}`);
    for (let i = 0; i < options.length; i++) {
      const active = i === idx;
      const cursor = active ? chalk.cyan("❯") : " ";
      const label  = active ? chalk.bold.white(options[i]!) : chalk.gray(options[i]!);
      process.stdout.write(`\x1b[2K  ${cursor} ${label}\n`);
    }
  }

  // Ensure keypress events are available (idempotent call).
  rl.emitKeypressEvents(process.stdin);

  // Enable raw mode so keys arrive individually without waiting for Enter.
  // readline typically sets this already; guard to avoid errors on non-TTY pipes.
  if (process.stdin.isTTY && !process.stdin.isRaw) {
    process.stdin.setRawMode(true);
  }

  // iface.pause() pauses stdin — resume it so keypress events fire.
  process.stdin.resume();

  // Draw initial menu
  process.stdout.write("\n");
  render(true);

  return new Promise<number | null>((resolve) => {
    let done = false;

    function onKeypress(
      _char: string | undefined,
      key: { name?: string; ctrl?: boolean; sequence?: string } | undefined
    ) {
      if (done || !key) return;

      if (key.name === "up") {
        idx = (idx - 1 + options.length) % options.length;
        render();
      } else if (key.name === "down") {
        idx = (idx + 1) % options.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup(idx);
      } else if (key.name === "escape") {
        cleanup(null);
      } else if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup(null);
      }
    }

    function cleanup(result: number | null) {
      if (done) return;
      done = true;
      process.stdin.removeListener("keypress", onKeypress);
      // Pause stdin again — repl.ts will resume it via iface.resume().
      process.stdin.pause();
      // Erase the menu lines
      process.stdout.write(`\x1b[${LINES}A`);
      for (let i = 0; i < LINES; i++) process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[${LINES}A`);
      resolve(result);
    }

    process.stdin.on("keypress", onKeypress);
  });
}
