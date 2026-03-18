import type { VerificationResult } from "../../types/verifier.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

export async function runLintCheck(workDir: string): Promise<VerificationResult> {
  const start = Date.now();

  // Detect linter: biome > eslint > skip
  const hasBiome = existsSync(join(workDir, "biome.json")) || existsSync(join(workDir, "biome.jsonc"));
  const hasEslint = existsSync(join(workDir, ".eslintrc.js")) ||
    existsSync(join(workDir, ".eslintrc.json")) ||
    existsSync(join(workDir, "eslint.config.js")) ||
    existsSync(join(workDir, "eslint.config.mjs"));

  let args: string[];
  if (hasBiome) {
    args = ["bunx", "biome", "check", "."];
  } else if (hasEslint) {
    args = ["bunx", "eslint", "."];
  } else {
    return {
      check: "lint",
      passed: true,
      output: "No linter config found — skipping",
      duration_ms: 0,
    };
  }

  try {
    const proc = Bun.spawn(args, {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const duration_ms = Date.now() - start;

    return {
      check: "lint",
      passed: exitCode === 0,
      output: (stdout + stderr).trim(),
      duration_ms,
      ...(exitCode !== 0 ? { error: "Lint check failed" } : {}),
    };
  } catch (err) {
    return {
      check: "lint",
      passed: false,
      output: "",
      duration_ms: Date.now() - start,
      error: String(err),
    };
  }
}
