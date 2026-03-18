import chalk from "chalk";

// ─── Bee ASCII frames (wings: up / mid / down) ───────────────────────────────

const W = chalk.cyan;   // wings
const Y = chalk.yellow; // body
const B = chalk.bold.black; // stripes
const E = chalk.bold.white; // eyes

type Frame = string[];

const FRAMES: Frame[] = [
  // wings UP
  [
    W("  \\   /  "),
    W("   \\ /   "),
    Y("  (") + E("◉") + Y("ω") + E("◉") + Y(")  "),
    Y(" ") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y(" "),
    Y("   ") + W("∪ ∪") + Y("   "),
  ],
  // wings MID
  [
    W(" ─       ─"),
    W("  ─     ─ "),
    Y("  (") + E("◉") + Y("ω") + E("◉") + Y(")  "),
    Y(" ") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y(" "),
    Y("   ") + W("∪ ∪") + Y("   "),
  ],
  // wings DOWN
  [
    W("  /   \\  "),
    W("   / \\   "),
    Y("  (") + E("◉") + Y("ω") + E("◉") + Y(")  "),
    Y(" ") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y("═") + B("▓") + Y(" "),
    Y("   ") + W("∪ ∪") + Y("   "),
  ],
];

const FRAME_HEIGHT = FRAMES[0]!.length;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const hide  = "\x1b[?25l";
const show  = "\x1b[?25h";
const up    = (n: number) => `\x1b[${n}A`;
const col   = (n: number) => `\x1b[${n}G`;
const clear = "\x1b[2K";

function printFrame(frame: Frame, xOffset: number) {
  for (const line of frame) {
    process.stdout.write(clear + col(xOffset) + line + "\n");
  }
}

function eraseBee() {
  process.stdout.write(up(FRAME_HEIGHT));
  for (let i = 0; i < FRAME_HEIGHT; i++) {
    process.stdout.write(clear + "\n");
  }
  process.stdout.write(up(FRAME_HEIGHT));
}

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

// ─── Full animated intro ──────────────────────────────────────────────────────

export async function showBeeIntro(): Promise<void> {
  const ttyWidth = process.stdout.columns ?? 80;
  const beeWidth = 12;
  const centerX = Math.floor(ttyWidth / 2) - Math.floor(beeWidth / 2);

  process.stdout.write(hide);

  // Reserve vertical space
  for (let i = 0; i < FRAME_HEIGHT; i++) process.stdout.write("\n");

  // Flap wings at center
  for (let i = 0; i < 9; i++) {
    process.stdout.write(up(FRAME_HEIGHT));
    printFrame(FRAMES[i % FRAMES.length]!, centerX);
    await sleep(100);
  }

  // Disappear
  eraseBee();
  process.stdout.write(show);
}

// ─── Inline bee for the banner (static, color) ────────────────────────────────

export const BEE_ICON = Y("(") + E("◉") + Y("ω") + E("◉") + Y(")");

// ─── Compact hover loop (for use while REPL is idle, optional) ───────────────

export function startIdleFlap(xOffset = 2): NodeJS.Timeout {
  let frame = 0;

  // Reserve 1 line below prompt — REPL must not be printing
  // This is best-effort; call stopIdleFlap() before any output
  process.stdout.write("\n");
  printFrame(FRAMES[0]!, xOffset);

  const timer = setInterval(() => {
    process.stdout.write(up(FRAME_HEIGHT));
    printFrame(FRAMES[frame % FRAMES.length]!, xOffset);
    frame++;
  }, 150);

  return timer;
}

export function stopIdleFlap(timer: NodeJS.Timeout) {
  clearInterval(timer);
  eraseBee();
}
