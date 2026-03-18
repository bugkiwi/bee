import chalk from "chalk";

/**
 * Inline arrow-key selection menu.
 *
 * Works while readline is paused (iface.pause() was called):
 * reads stdin in non-flowing mode via the 'readable' event so
 * readline's data listener never fires and there is no conflict.
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

  // Draw initial menu
  process.stdout.write("\n");
  render(true);

  return new Promise<number | null>((resolve) => {
    let buf = "";

    function onReadable() {
      let chunk: Buffer | string | null;
      // eslint-disable-next-line no-cond-assign
      while ((chunk = process.stdin.read() as Buffer | string | null) !== null) {
        buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        processBuffer();
      }
    }

    function processBuffer() {
      while (buf.length > 0) {
        if (buf.startsWith("\x1b[A") || buf.startsWith("\x1bOA")) {
          // Up arrow
          buf = buf.slice(buf.startsWith("\x1b[A") ? 3 : 3);
          idx = (idx - 1 + options.length) % options.length;
          render();
        } else if (buf.startsWith("\x1b[B") || buf.startsWith("\x1bOB")) {
          // Down arrow
          buf = buf.slice(3);
          idx = (idx + 1) % options.length;
          render();
        } else if (buf[0] === "\r" || buf[0] === "\n") {
          // Enter
          buf = buf.slice(1);
          cleanup(idx);
          return;
        } else if (buf[0] === "\x1b" && buf.length < 3) {
          // Incomplete escape — wait for more data
          break;
        } else if (buf[0] === "\x1b") {
          // Escape alone or unknown sequence → cancel
          cleanup(null);
          return;
        } else if (buf[0] === "\x03" || buf[0] === "\x04") {
          // Ctrl+C / Ctrl+D → cancel
          cleanup(null);
          return;
        } else {
          // Ignore any other char
          buf = buf.slice(1);
        }
      }
    }

    function cleanup(result: number | null) {
      process.stdin.removeListener("readable", onReadable);
      // Erase the menu lines
      process.stdout.write(`\x1b[${LINES}A`);
      for (let i = 0; i < LINES; i++) process.stdout.write("\x1b[2K\n");
      process.stdout.write(`\x1b[${LINES}A`);
      resolve(result);
    }

    process.stdin.on("readable", onReadable);
    // Kick off in case data is already buffered
    onReadable();
  });
}
