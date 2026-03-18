import type { Task } from "../types/task.ts";

export interface TestRunResult {
  passed: boolean;
  attempts: number;
  lastError?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Run the test command in workDir. Returns { passed, output }.
 */
async function runTests(
  cmd: string[],
  workDir: string
): Promise<{ passed: boolean; output: string }> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return {
      passed: code === 0,
      output: [stdout, stderr].filter(Boolean).join("\n"),
    };
  } catch (err) {
    return { passed: false, output: String(err) };
  }
}

/**
 * Ask Claude to fix test failures.
 */
async function callClaudeToFix(errorOutput: string): Promise<void> {
  try {
    const prompt = `Fix these test failures:\n\n${errorOutput.slice(0, 4000)}`;
    const proc = Bun.spawn(
      ["claude", "--print", "--dangerously-skip-permissions", prompt],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    await proc.exited;
  } catch {
    // Ignore errors — we'll just retry the tests
  }
}

/**
 * Parse a runtime_check_cmd string into an argv array.
 * Handles simple quoted strings but not complex shell syntax.
 */
function parseCmd(cmdStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of cmdStr) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

export class TestRunner {
  async run(
    task: Task,
    workDir: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS
  ): Promise<TestRunResult> {
    const cmd = task.runtime_check_cmd
      ? parseCmd(task.runtime_check_cmd)
      : ["bun", "test"];

    let attempts = 0;
    let lastError: string | undefined;

    while (attempts < maxAttempts) {
      attempts++;
      const { passed, output } = await runTests(cmd, workDir);

      if (passed) {
        return { passed: true, attempts };
      }

      lastError = output;

      // If we have more attempts left, ask Claude to fix
      if (attempts < maxAttempts) {
        await callClaudeToFix(output);
      }
    }

    return { passed: false, attempts, lastError };
  }
}
