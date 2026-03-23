import type { AgentTask as Task } from "../types/task.ts";
import type { VerificationResult, VerificationSummary } from "../types/verifier.ts";
import { runTestCheck } from "./checks/tests.ts";
import { runLintCheck } from "./checks/lint.ts";
import { runTypeCheck } from "./checks/typecheck.ts";
import { runRuntimeCheck } from "./checks/runtime.ts";

export class Verifier {
  async runAll(task: Task, workDir?: string): Promise<VerificationSummary> {
    const dir = workDir ?? task.working_dir ?? process.cwd();
    const start = Date.now();
    const checks: VerificationResult[] = [];

    if (task.tests_required) {
      checks.push(await runTestCheck(dir));
    }

    checks.push(await runLintCheck(dir));
    checks.push(await runTypeCheck(dir));

    if (task.runtime_check_cmd) {
      checks.push(await runRuntimeCheck(task.runtime_check_cmd, dir));
    }

    const passed = checks.every((c) => c.passed);
    return {
      task_id: task.task_id,
      passed,
      checks,
      total_duration_ms: Date.now() - start,
    };
  }
}
