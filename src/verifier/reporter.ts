import type { VerificationSummary } from "../types/verifier.ts";
import chalk from "chalk";

export class VerificationReporter {
  print(summary: VerificationSummary): void {
    const icon = summary.passed ? chalk.green("✓") : chalk.red("✗");
    console.log(`\n${icon} Verification ${summary.passed ? "PASSED" : "FAILED"} — ${summary.total_duration_ms}ms\n`);

    for (const check of summary.checks) {
      const checkIcon = check.passed ? chalk.green("  ✓") : chalk.red("  ✗");
      const name = chalk.bold(check.check.padEnd(12));
      const time = chalk.gray(`(${check.duration_ms}ms)`);
      console.log(`${checkIcon} ${name} ${time}`);
      if (!check.passed && check.output) {
        const lines = check.output.split("\n").slice(0, 10).join("\n    ");
        console.log(chalk.gray(`    ${lines}`));
      }
    }
    console.log();
  }

  printSummaryLine(summaries: VerificationSummary[]): void {
    const passed = summaries.filter((s) => s.passed).length;
    const total = summaries.length;
    const icon = passed === total ? chalk.green("✓") : chalk.red("✗");
    console.log(`${icon} ${passed}/${total} tasks verified`);
  }
}
