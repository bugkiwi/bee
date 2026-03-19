#!/usr/bin/env bun
import { buildCli } from "./cli/index.ts";
import { runRepl as runInkRepl } from "./cli/repl-ink.tsx";
import { findWorkspaceRoot, getWorkspaceDirs } from "./utils/workspace.ts";
import { readJsonFile, fileExists, writeJsonFile } from "./utils/fs.ts";
import { DEFAULT_CONFIG, type WorkspaceConfig } from "./types/config.ts";
import { WorkspaceConfigSchema } from "./schema/config.schema.ts";
import { runFirstRunWizardInk } from "./cli/wizard-ink.tsx";

interface InteractiveModeArgs {
  isInteractive: boolean;
  resumeSessionId?: string;
  resumeLatest?: boolean;
  error?: string;
}

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const raw = await readJsonFile(configPath);
    const parsed = WorkspaceConfigSchema.safeParse(raw);
    return parsed.success ? (parsed.data as WorkspaceConfig) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function canUseInkRepl(): boolean {
  return Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    typeof (process.stdin as NodeJS.ReadStream).setRawMode === "function"
  );
}

function parseInteractiveModeArgs(args: string[]): InteractiveModeArgs {
  if (args.length === 0) return { isInteractive: true };

  let resumeSessionId: string | undefined;
  let resumeLatest = false;
  const passthroughArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--resume") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        resumeLatest = true;
        continue;
      }
      resumeSessionId = value;
      i++;
      continue;
    }

    if (arg.startsWith("--resume=")) {
      const value = arg.slice("--resume=".length);
      if (!value) {
        resumeLatest = true;
        continue;
      }
      resumeSessionId = value;
      continue;
    }

    passthroughArgs.push(arg);
  }

  if ((resumeSessionId || resumeLatest) && passthroughArgs.length > 0) {
    return {
      isInteractive: true,
      error: "`--resume` only works in interactive mode. Usage: bee --resume [session-id]",
    };
  }

  if (resumeSessionId || resumeLatest) {
    return { isInteractive: true, resumeSessionId, resumeLatest };
  }

  return { isInteractive: false };
}

async function main() {
  const args = process.argv.slice(2);
  const interactiveModeArgs = parseInteractiveModeArgs(args);

  if (interactiveModeArgs.isInteractive) {
    if (interactiveModeArgs.error) {
      throw new Error(interactiveModeArgs.error);
    }

    const root = findWorkspaceRoot();
    const dirs = getWorkspaceDirs(root);
    let config = await loadConfig(dirs.config);
    const supportsInk = canUseInkRepl();

    // First-run setup
    if (fileExists(dirs.config) && !config._initialized) {
      if (supportsInk) {
        config = await runFirstRunWizardInk(config, dirs.config);
      } else {
        // Non-interactive path: initialize with defaults.
        config = { ...config, _initialized: true };
        await writeJsonFile(dirs.config, config);
      }
    }

    if (!supportsInk) {
      throw new Error("Interactive mode requires a TTY. Use subcommands like `bee run` in non-interactive environments.");
    }

    await runInkRepl(config, dirs, {
      resumeSessionId: interactiveModeArgs.resumeSessionId,
      resumeLatest: interactiveModeArgs.resumeLatest,
    });
    return;
  }

  const program = buildCli();
  program.parse(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
