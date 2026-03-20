import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const SCREENSHOT_DIR = "/tmp/bee";

export function ensureScreenshotDir(): void {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const CLIPBOARD_SIZE_SCRIPT = `
try
  set info to clipboard info
  repeat with entry in info
    if (item 1 of entry as string) contains "PNGf" then
      return item 2 of entry as string
    end if
  end repeat
  return "0"
on error
  return "0"
end try`;

/**
 * Returns the byte-size of the PNG in the clipboard, or 0 if none.
 * Sync version — only use for one-time baseline checks (blocks event loop).
 */
export function clipboardImageSize(): number {
  if (process.platform !== "darwin") return 0;
  const r = spawnSync("osascript", ["-e", CLIPBOARD_SIZE_SCRIPT], { encoding: "utf8", timeout: 800 });
  return parseInt(r.stdout?.trim() ?? "0", 10) || 0;
}

/**
 * Async version of clipboardImageSize — does not block the event loop.
 */
export async function clipboardImageSizeAsync(): Promise<number> {
  if (process.platform !== "darwin") return 0;
  try {
    const proc = Bun.spawn(["osascript", "-e", CLIPBOARD_SIZE_SCRIPT], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    return parseInt(text.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Attempt to read an image from the macOS clipboard and save it to /tmp/bee/.
 * Returns the saved file path, or null if the clipboard contains no image.
 */
export async function saveClipboardImage(): Promise<string | null> {
  if (process.platform !== "darwin") return null;

  const ts = Date.now();
  const pngPath = join(SCREENSHOT_DIR, `${ts}.png`);
  const tiffPath = join(SCREENSHOT_DIR, `${ts}.tiff`);

  // AppleScript: try PNG first, fall back to TIFF
  const script = `
try
  set imgData to the clipboard as «class PNGf»
  set f to open for access POSIX file "${pngPath}" with write permission
  write imgData to f
  close access f
  return "${pngPath}"
on error
  try
    set imgData to the clipboard as «class TIFF»
    set f to open for access POSIX file "${tiffPath}" with write permission
    write imgData to f
    close access f
    return "${tiffPath}"
  on error
    return ""
  end try
end try
`.trim();

  const res = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    timeout: 4000,
  });

  const out = res.stdout?.trim() ?? "";
  if (out === pngPath || out === tiffPath) return out;
  return null;
}
