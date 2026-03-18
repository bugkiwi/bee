import * as readline from "node:readline";
import chalk from "chalk";
import type { WorkspaceConfig } from "../types/config.ts";
import { writeJsonFile } from "../utils/fs.ts";
import { rtkStatus } from "../plugins/rtk.ts";

type ProviderChoice = "claude" | "codex" | "kimi";

const PROVIDERS: Array<{ key: ProviderChoice; label: string; desc: string }> = [
  {
    key: "claude",
    label: "Claude Code",
    desc: "Anthropic Claude — local subprocess (requires `claude` CLI)",
  },
  {
    key: "codex",
    label: "Codex",
    desc: "OpenAI Codex — local subprocess (requires `codex` CLI)",
  },
  {
    key: "kimi",
    label: "Kimi",
    desc: "Kimi — local subprocess (requires `kimi` CLI)",
  },
];

function ask(iface: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    iface.question(question, resolve);
  });
}

export async function runFirstRunWizard(
  config: WorkspaceConfig,
  configPath: string,
  iface: readline.Interface
): Promise<WorkspaceConfig> {
  console.log(chalk.bold.cyan("\n╔══════════════════════════════════╗"));
  console.log(chalk.bold.cyan("║   BEE — First Run Setup           ║"));
  console.log(chalk.bold.cyan("╚══════════════════════════════════╝\n"));

  console.log("Select a provider for BEE to use:\n");
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i]!;
    console.log(`  ${chalk.bold(`[${i + 1}]`)} ${chalk.cyan(p.label)}`);
    console.log(chalk.gray(`      ${p.desc}\n`));
  }

  let choice: ProviderChoice = "claude";
  while (true) {
    const answer = await ask(iface, chalk.bold("Provider [1-3]: "));
    const n = parseInt(answer.trim(), 10);
    if (n >= 1 && n <= PROVIDERS.length) {
      const selected = PROVIDERS[n - 1];
      if (selected) {
        choice = selected.key;
        break;
      }
    }
    console.log(chalk.red("  Please enter 1, 2, or 3."));
  }


  // RTK
  const rtk = await rtkStatus();
  let useRtk = false;
  if (rtk.available) {
    console.log(chalk.green(`\n✓ RTK detected (${rtk.version})`));
    const ans = await ask(
      iface,
      chalk.bold("Enable RTK token savings for provider calls? [Y/n]: ")
    );
    useRtk = ans.trim().toLowerCase() !== "n";
  } else {
    console.log(chalk.gray("\n  RTK not found — skipping.\n"));
  }

  const updated: WorkspaceConfig = {
    ...config,
    provider: choice,
    use_rtk: useRtk,
    _initialized: true,
  };

  await writeJsonFile(configPath, updated);
  console.log(chalk.green(`\n✓ Setup complete — using ${chalk.bold(choice)}\n`));
  return updated;
}
