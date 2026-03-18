import type { VerificationResult } from "../../types/verifier.ts";

export async function runTestCheck(workDir: string): Promise<VerificationResult> {
  const start = Date.now();
  try {
    const proc = Bun.spawn(["bun", "test", "--bail"], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const duration_ms = Date.now() - start;
    const output = (stdout + stderr).trim();

    return {
      check: "tests",
      passed: exitCode === 0,
      output,
      duration_ms,
      ...(exitCode !== 0 ? { error: `Tests failed (exit ${exitCode})` } : {}),
    };
  } catch (err) {
    return {
      check: "tests",
      passed: false,
      output: "",
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}
