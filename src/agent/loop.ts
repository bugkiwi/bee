import type { Task } from "../types/task.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import { TaskLoader } from "../tasks/loader.ts";
import { TaskWriter } from "../tasks/writer.ts";
import { TaskPicker } from "../tasks/picker.ts";
import { StateStore } from "../state/store.ts";
import { SessionStore } from "../state/session.ts";
import { stateMachine } from "../state/machine.ts";
import { TaskExecutor } from "./executor.ts";
import { Retrier } from "./retrier.ts";
import { Verifier } from "../verifier/index.ts";
import { VerificationReporter } from "../verifier/reporter.ts";
import { Tracer } from "../observability/tracer.ts";
import { Logger } from "../observability/logger.ts";
import { CostTracker } from "../observability/cost.ts";
import { detectLimit } from "../providers/limit.ts";
import { join } from "node:path";
import chalk from "chalk";

export interface LoopOptions {
  taskId?: string;
  dryRun?: boolean;
  verbose?: boolean;
  /** Called when a provider limit is hit — returns the new provider to use or null to abort */
  onLimitHit?: (provider: string, message: string) => Promise<string | null>;
}

export class AgentLoop {
  private readonly loader: TaskLoader;
  private readonly writer: TaskWriter;
  private readonly picker: TaskPicker;
  private readonly stateStore: StateStore;
  private readonly sessionStore: SessionStore;
  private readonly executor: TaskExecutor;
  private readonly retrier: Retrier;
  private readonly verifier: Verifier;
  private readonly reporter: VerificationReporter;
  private readonly dirs: { tasks: string; state: string; logs: string };

  constructor(
    private readonly config: WorkspaceConfig,
    dirs: { tasks: string; state: string; logs: string }
  ) {
    this.dirs = dirs;
    this.loader = new TaskLoader(dirs.tasks);
    this.writer = new TaskWriter(dirs.tasks);
    this.picker = new TaskPicker();
    this.stateStore = new StateStore(dirs.state);
    this.sessionStore = new SessionStore(dirs.state);
    this.executor = new TaskExecutor(config);
    this.retrier = new Retrier({
      max_attempts: config.max_retries,
      backoff_ms: config.backoff_ms,
      backoff_multiplier: config.backoff_multiplier,
      jitter: true,
    });
    this.verifier = new Verifier();
    this.reporter = new VerificationReporter();
  }

  async run(opts: LoopOptions = {}): Promise<void> {
    const allTasks = await this.loader.loadAll();

    let tasks: Task[];
    if (opts.taskId) {
      const task = allTasks.find((t) => t.task_id === opts.taskId);
      if (!task) {
        console.error(chalk.red(`Task not found: ${opts.taskId}`));
        return;
      }
      tasks = [task];
    } else {
      tasks = this.picker.pickAll(allTasks);
    }

    if (tasks.length === 0) {
      console.log(chalk.yellow("No tasks to run."));
      return;
    }

    console.log(chalk.bold(`\nRunning ${tasks.length} task(s)\n`));

    for (const task of tasks) {
      await this.runTask(task, opts);
    }
  }

  private async runTask(task: Task, opts: LoopOptions): Promise<void> {
    const tracer = new Tracer(task.task_id);
    const logger = new Logger(this.dirs.logs, tracer.traceId, opts.verbose ?? false);
    const costTracker = new CostTracker(
      join(this.dirs.logs, "costs.jsonl"),
      this.config
    );

    console.log(chalk.bold(`\n▶ ${task.task_id}: ${task.goal}`));

    if (opts.dryRun) {
      console.log(chalk.gray("  [dry-run] Would execute this task."));
      return;
    }

    // Initialize state + session
    let state = await this.stateStore.init(task.task_id);
    const session = await this.sessionStore.init(this.config.provider);

    // Transition to running
    state.current_status = stateMachine.transition(
      state.current_status === "retrying" ? "retrying" : "pending",
      state.current_status === "retrying" ? "resume_run" : "start"
    );
    await this.stateStore.save(state);
    task.status = state.current_status;
    await this.writer.update(task);

    await logger.log(tracer.emit("task.start", { goal: task.goal }));

    let attempt = state.runs.length;
    let keepRunning = true;
    // Track current provider (may switch mid-run on limit)
    let activeProvider = session.active_provider ?? this.config.provider;

    while (keepRunning) {
      // Execute
      const { result, record } = await this.executor.execute(
        { ...task, provider: activeProvider },
        tracer,
        logger,
        costTracker,
        attempt
      );

      // Track tokens in session
      if (result.tokens_input || result.tokens_output) {
        await this.sessionStore.addTokens(
          activeProvider,
          (result.tokens_input ?? 0) + (result.tokens_output ?? 0),
          result.cost_usd ?? 0
        );
      }

      state.runs.push(record);

      if (result.success) {
        // Transition to verifying
        state.current_status = stateMachine.transition("running", "provider_success");
        await this.stateStore.save(state);
        task.status = state.current_status;
        await this.writer.update(task);

        await logger.log(tracer.emit("verify.start"));

        // Verify
        const summary = await this.verifier.runAll(task);
        this.reporter.print(summary);

        const errors = summary.checks
          .filter((c) => !c.passed)
          .map((c) => c.error ?? `${c.check} failed`);

        if (summary.passed) {
          state.current_status = stateMachine.transition("verifying", "verify_pass");
          state.last_verified_at = new Date().toISOString();
          record.verification_result = "pass";
          await this.stateStore.save(state);
          task.status = "done";
          await this.writer.update(task);
          await logger.log(
            tracer.emit("task.complete", undefined, tracer.elapsed())
          );
          console.log(chalk.green(`✓ ${task.task_id} done — ${costTracker.summary()}`));
          keepRunning = false;
        } else {
          state.current_status = stateMachine.transition("verifying", "verify_fail");
          state.verification_errors = errors;
          record.verification_result = "fail";
          await this.stateStore.save(state);
          task.status = "failed";
          await this.writer.update(task);
          await logger.log(tracer.emit("verify.fail", { errors }));

          if (this.retrier.shouldRetry(state)) {
            attempt++;
            state.current_status = stateMachine.transition("failed", "retry");
            await this.stateStore.save(state);
            await logger.log(tracer.emit("retry.attempt", { attempt }));
            console.log(chalk.yellow(`  ↺ Retry ${attempt}/${this.config.max_retries}...`));
            await this.retrier.waitBeforeRetry(attempt);
            state.current_status = stateMachine.transition("retrying", "resume_run");
            await this.stateStore.save(state);
          } else {
            console.log(chalk.red(`✗ ${task.task_id} failed after ${attempt} attempt(s)`));
            keepRunning = false;
          }
        }
      } else {
        // Check for limit events (rate limit, budget, auth)
        const limitEvent = detectLimit(result);
        if (limitEvent && opts.onLimitHit) {
          await this.sessionStore.recordLimitEvent(
            activeProvider,
            limitEvent.kind,
            limitEvent.message
          );
          console.log(
            chalk.red(`\n  ⚠ ${limitEvent.kind.replace("_", " ").toUpperCase()}: ${limitEvent.message}`)
          );
          const newProvider = await opts.onLimitHit(activeProvider, limitEvent.message);
          if (newProvider && newProvider !== activeProvider) {
            console.log(chalk.yellow(`  → Switching to ${chalk.bold(newProvider)}...`));
            await this.sessionStore.switchProvider(newProvider, limitEvent.message);
            activeProvider = newProvider;
            // Reset attempt count for fresh provider, re-enter loop
            state.current_status = stateMachine.transition(
              state.current_status === "failed" ? "failed" : "running",
              "retry"
            );
            await this.stateStore.save(state);
            state.current_status = stateMachine.transition("retrying", "resume_run");
            await this.stateStore.save(state);
            continue;
          }
        }

        // Provider failure
        state.current_status = stateMachine.transition("running", "provider_failure");
        state.verification_errors = [result.error ?? "Provider failed"];
        await this.stateStore.save(state);
        task.status = "failed";
        await this.writer.update(task);
        await logger.log(
          tracer.emit("task.fail", { error: result.error }, tracer.elapsed())
        );

        if (this.retrier.shouldRetry(state)) {
          attempt++;
          state.current_status = stateMachine.transition("failed", "retry");
          await this.stateStore.save(state);
          await logger.log(tracer.emit("retry.attempt", { attempt }));
          console.log(chalk.yellow(`  ↺ Retry ${attempt}/${this.config.max_retries}...`));
          await this.retrier.waitBeforeRetry(attempt);
          state.current_status = stateMachine.transition("retrying", "resume_run");
          await this.stateStore.save(state);
        } else {
          console.log(chalk.red(`✗ ${task.task_id} failed: ${result.error}`));
          keepRunning = false;
        }
      }
    }
  }
}
