#!/usr/bin/env bun
import { buildCli } from "./cli/index.ts";
import { runRepl as runInkRepl } from "./cli/repl-ink.tsx";
import { restoreTerminalAfterCrash } from "./cli/ui/terminal.ts";
import { findWorkspaceRoot, getWorkspaceDirs } from "./utils/workspace.ts";
import { readJsonFile, fileExists, writeJsonFile } from "./utils/fs.ts";
import {
  DEFAULT_CONFIG,
  normalizeWorkspaceConfig,
  type WorkspaceConfig,
} from "./types/config.ts";
import { WorkspaceConfigSchema } from "./schema/config.schema.ts";
import { runFirstRunWizardInk } from "./cli/wizard-ink.tsx";
import {
  createCrashLogger,
  type CrashLogger,
  installProcessCrashHandlers,
} from "./observability/crash-logger.ts";

interface InteractiveModeArgs {
  isInteractive: boolean;
  resumeSessionId?: string;
  resumeLatest?: boolean;
  error?: string;
}

let activeCrashLogger: CrashLogger | null = null;

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const raw = await readJsonFile(configPath);
    const parsed = WorkspaceConfigSchema.safeParse(raw);
    return parsed.success
      ? normalizeWorkspaceConfig(parsed.data as WorkspaceConfig)
      : DEFAULT_CONFIG;
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

function shouldShowBeeIntro(): boolean {
  return !process.env.CI && process.env.BEE_NO_INTRO !== "1";
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
  const root = findWorkspaceRoot();
  const dirs = getWorkspaceDirs(root);
  const crashLogger = createCrashLogger(dirs.logs);
  activeCrashLogger = crashLogger;
  installProcessCrashHandlers(crashLogger, {
    baseContext: {
      entry: "main",
      argv: args,
      cwd: process.cwd(),
    },
    beforeReport: restoreTerminalAfterCrash,
  });
  const interactiveModeArgs = parseInteractiveModeArgs(args);

  if (interactiveModeArgs.isInteractive) {
    if (interactiveModeArgs.error) {
      throw new Error(interactiveModeArgs.error);
    }

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
      showIntro: shouldShowBeeIntro(),
      crashLogger,
    });
    return;
  }

  const program = buildCli();
  program.parse(process.argv);
}

main().catch((err) => {
  restoreTerminalAfterCrash();
  const alreadyLogged =
    err &&
    typeof err === "object" &&
    "__beeCrashLogged" in err &&
    err.__beeCrashLogged === true;
  if (!alreadyLogged) {
    const crashLogger =
      activeCrashLogger ??
      createCrashLogger(getWorkspaceDirs(findWorkspaceRoot()).logs);
    const logPath = crashLogger.captureSync(err, {
      scope: "main.catch",
      cwd: process.cwd(),
      argv: process.argv.slice(2),
    });
    process.stderr.write(`Bee crash log: ${logPath}\n`);
  }
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
