#!/usr/bin/env bun
import * as readline from "node:readline";
import { buildCli } from "./cli/index.ts";
import { runRepl } from "./cli/repl.ts";
import { findWorkspaceRoot, getWorkspaceDirs } from "./utils/workspace.ts";
import { readJsonFile, fileExists } from "./utils/fs.ts";
import { DEFAULT_CONFIG, type WorkspaceConfig } from "./types/config.ts";
import { WorkspaceConfigSchema } from "./schema/config.schema.ts";
import { runFirstRunWizard } from "./cli/wizard.ts";
import { buildCompleter } from "./cli/commands.ts";

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const raw = await readJsonFile(configPath);
    const parsed = WorkspaceConfigSchema.safeParse(raw);
    return parsed.success ? (parsed.data as WorkspaceConfig) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const root = findWorkspaceRoot();
    const dirs = getWorkspaceDirs(root);
    let config = await loadConfig(dirs.config);

    // Create ONE readline interface shared by wizard → REPL
    const iface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: buildCompleter(),
      terminal: process.stdin.isTTY ?? false,
    });

    // First-run wizard (TTY only; skip in piped/CI mode)
    if (fileExists(dirs.config) && !config._initialized) {
      if (process.stdin.isTTY) {
        config = await runFirstRunWizard(config, dirs.config, iface);
        // Reload saved config
        config = await loadConfig(dirs.config);
      } else {
        // Auto-initialize with defaults in non-TTY
        config._initialized = true;
      }
    }

    await runRepl(config, dirs, iface);
    return;
  }

  const program = buildCli();
  program.parse(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
