/** Commands allowed to run without confirmation in skeleton exit-condition checks */
const ALLOWED_PREFIXES = [
  "bun test",
  "bun run",
  "bun build",
  "git diff",
  "git log",
  "git status",
  "git show",
  "npm test",
  "npm run",
  "npx tsc",
  "tsc",
  "eslint",
  "ls ",
  "ls\n",
  "cat ",
  "echo ",
  "test ",
  "[ ",
  "grep ",
];

export type CommandCheckResult = "allowed" | "confirm";

export class DisallowedCommandError extends Error {
  constructor(public readonly cmd: string) {
    super(`Command requires confirmation: ${cmd}`);
    this.name = "DisallowedCommandError";
  }
}

/**
 * Check whether a shell command is in the safe allowlist.
 * Returns 'allowed' if safe to run automatically, 'confirm' if user must approve.
 */
export function checkCommand(cmd: string): CommandCheckResult {
  const trimmed = cmd.trim();
  for (const prefix of ALLOWED_PREFIXES) {
    if (trimmed.startsWith(prefix) || trimmed === prefix.trim()) {
      return "allowed";
    }
  }
  // Also allow plain "ls" with no args
  if (trimmed === "ls") return "allowed";
  return "confirm";
}
