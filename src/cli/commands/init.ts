import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { DEFAULT_CONFIG } from "../../types/config.ts";
import chalk from "chalk";

export async function runInit(root: string): Promise<void> {
  console.log(chalk.bold.cyan("\n⚙  BEE Init\n"));

  const dirs = ["tasks", "state", "specs", "logs", "providers", ".bee"];
  for (const dir of dirs) {
    const path = join(root, dir);
    await mkdir(path, { recursive: true });
    console.log(chalk.gray(`  created ${dir}/`));
  }

  const configPath = join(root, ".bee", "config.json");
  if (!existsSync(configPath)) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    console.log(chalk.gray("  created .bee/config.json"));
  } else {
    console.log(chalk.gray("  .bee/config.json already exists — skipping"));
  }

  // Check provider availability
  const providers: Array<{ name: string; cmd: string }> = [
    { name: "claude", cmd: "claude" },
    { name: "codex", cmd: "codex" },
  ];

  console.log("\nProvider health check:");
  for (const { name, cmd } of providers) {
    try {
      const proc = Bun.spawn([cmd, "--version"], { stdout: "pipe", stderr: "pipe" });
      const code = await proc.exited;
      const icon = code === 0 ? chalk.green("✓") : chalk.yellow("?");
      console.log(`  ${icon} ${name}`);
    } catch {
      console.log(`  ${chalk.yellow("?")} ${name} (not found)`);
    }
  }

  console.log(chalk.green("\n✓ Workspace initialized.\n"));
  console.log("Next steps:");
  console.log("  1. Place spec files in specs/");
  console.log("  2. Run: bee plan specs/your-spec.md");
  console.log("  3. Run: bee run\n");
}
