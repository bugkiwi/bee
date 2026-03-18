import type { VerificationResult } from "../../types/verifier.ts";

export async function runRuntimeCheck(
  cmd: string,
  workDir: string
): Promise<VerificationResult> {
  const start = Date.now();
  try {
    const parts = cmd.split(/\s+/);
    const proc = Bun.spawn(parts, {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const duration_ms = Date.now() - start;

    return {
      check: "runtime",
      passed: exitCode === 0,
      output: (stdout + stderr).trim(),
      duration_ms,
      ...(exitCode !== 0 ? { error: `Runtime check failed (exit ${exitCode})` } : {}),
    };
  } catch (err) {
    return {
      check: "runtime",
      passed: false,
      output: "",
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}
