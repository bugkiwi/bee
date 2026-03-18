import chalk from "chalk";

let _rtkAvailable: boolean | null = null;

export async function isRtkAvailable(): Promise<boolean> {
  if (_rtkAvailable !== null) return _rtkAvailable;
  try {
    const proc = Bun.spawn(["rtk", "--version"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    _rtkAvailable = code === 0;
  } catch {
    _rtkAvailable = false;
  }
  return _rtkAvailable;
}

/**
 * Wrap a command array with `rtk` prefix if RTK is available and use_rtk is enabled.
 * e.g. ["claude", "--print", ...] → ["rtk", "claude", "--print", ...]
 */
export async function wrapWithRtk(
  args: string[],
  useRtk: boolean
): Promise<string[]> {
  if (!useRtk) return args;
  if (!(await isRtkAvailable())) return args;
  return ["rtk", ...args];
}

/**
 * Show RTK token savings after a run session.
 */
export async function showRtkGain(): Promise<void> {
  if (!(await isRtkAvailable())) return;
  try {
    const proc = Bun.spawn(["rtk", "gain"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code === 0 && out.trim()) {
      console.log(chalk.gray("\n─── RTK Savings ───"));
      console.log(chalk.gray(out.trim()));
      console.log(chalk.gray("───────────────────\n"));
    }
  } catch {}
}

/**
 * Check and display RTK availability status.
 */
export async function rtkStatus(): Promise<{ available: boolean; version?: string }> {
  try {
    const proc = Bun.spawn(["rtk", "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code === 0) {
      return { available: true, version: out.trim() };
    }
  } catch {}
  return { available: false };
}
