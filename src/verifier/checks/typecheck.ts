import type { VerificationResult } from "../../types/verifier.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function runTypeCheck(workDir: string): Promise<VerificationResult> {
  const start = Date.now();

  const hasTsConfig = existsSync(join(workDir, "tsconfig.json"));
  if (!hasTsConfig) {
    return {
      check: "typecheck",
      passed: true,
      output: "No tsconfig.json found — skipping",
      duration_ms: 0,
    };
  }

  try {
    const proc = Bun.spawn(["bunx", "tsc", "--noEmit"], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const duration_ms = Date.now() - start;

    return {
      check: "typecheck",
      passed: exitCode === 0,
      output: (stdout + stderr).trim(),
      duration_ms,
      ...(exitCode !== 0 ? { error: "TypeScript errors found" } : {}),
    };
  } catch (err) {
    return {
      check: "typecheck",
      passed: false,
      output: "",
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}
