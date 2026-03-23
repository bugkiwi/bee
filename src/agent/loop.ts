import type { AgentTask as Task } from "../types/task.ts";
import type { Plan } from "../types/plan.ts";
import type { PlanSkeleton, SkeletonNode, SkeletonProgressEvent } from "../types/skeleton.ts";
import type { AskPlan, AskPlanNode } from "../types/ask-plan.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import { TaskLoader } from "../tasks/loader.ts";
import { TaskWriter } from "../tasks/writer.ts";
import { TaskPicker } from "../tasks/picker.ts";
import { Planner } from "../tasks/planner.ts";
import { StateStore } from "../state/store.ts";
import { SessionStore } from "../state/session.ts";
import { SkeletonStore } from "../state/skeleton.ts";
import { AskPlanStore } from "../state/ask-plan.ts";
import { stateMachine } from "../state/machine.ts";
import { TaskExecutor } from "./executor.ts";
import { Retrier } from "./retrier.ts";
import { Verifier } from "../verifier/index.ts";
import { VerificationReporter } from "../verifier/reporter.ts";
import { Tracer } from "../observability/tracer.ts";
import { Logger } from "../observability/logger.ts";
import { CostTracker } from "../observability/cost.ts";
import { SkeletonLogger } from "../observability/skeleton-logger.ts";
import type { SkeletonLogEntry } from "../observability/skeleton-logger.ts";
import { detectLimit } from "../providers/limit.ts";
import { stripAnsi } from "../utils/strip-ansi.ts";
import { checkCommand } from "../utils/command-gate.ts";
import { join, dirname } from "node:path";
import chalk from "chalk";

// ── Error types ────────────────────────────────────────────────────────────────

export class NodeFailedError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly nodeTitle: string,
    public readonly cause: Error
  ) {
    super(`Node "${nodeTitle}" failed: ${cause.message}`);
    this.name = "NodeFailedError";
  }
}

export class UserAbortError extends Error {
  constructor() {
    super("Run aborted by user");
    this.name = "UserAbortError";
  }
}

export class AllProvidersExhaustedError extends Error {
  constructor() {
    super("All providers exhausted");
    this.name = "AllProvidersExhaustedError";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LoopOptions {
  taskId?: string;
  dryRun?: boolean;
  verbose?: boolean;
  /** Called when a provider limit is hit — returns the new provider to use or null to abort */
  onLimitHit?: (provider: string, message: string) => Promise<string | null>;
}

export interface SkeletonRunOptions extends LoopOptions {
  onProgress?: (event: SkeletonProgressEvent) => void;
  /** Called with the skeleton + cost estimate. Return true to proceed, false to abort. */
  onSkeletonReady?: (skeleton: PlanSkeleton, costEstimate: string) => Promise<boolean>;
  /** Override for where to confirm disallowed commands (for testing) */
  onDisallowedCommand?: (cmd: string) => Promise<boolean>;
}

export interface AskRunOptions extends LoopOptions {
  /** Called with the full recursive plan after decomposition. Return true to execute, false to abort. */
  onPlanReady?: (plan: AskPlan) => Promise<boolean>;
  onDisallowedCommand?: (cmd: string) => Promise<boolean>;
}

// ── AgentLoop ─────────────────────────────────────────────────────────────────

export class AgentLoop {
  private readonly loader: TaskLoader;
  private readonly writer: TaskWriter;
  private readonly picker: TaskPicker;
  private readonly planner: Planner;
  private readonly stateStore: StateStore;
  private readonly sessionStore: SessionStore;
  private readonly skeletonStore: SkeletonStore;
  private readonly askPlanStore: AskPlanStore;
  private readonly executor: TaskExecutor;
  private readonly retrier: Retrier;
  private readonly verifier: Verifier;
  private readonly reporter: VerificationReporter;
  private readonly dirs: { tasks: string; state: string; logs: string; plans: string };

  constructor(
    private readonly config: WorkspaceConfig,
    dirs: { tasks: string; state: string; logs: string; plans?: string },
    stores?: { askPlanStore?: AskPlanStore }
  ) {
    const plansDir = dirs.plans ?? join(dirname(dirs.state), "plans");
    this.dirs = { ...dirs, plans: plansDir };
    this.loader = new TaskLoader(dirs.tasks);
    this.writer = new TaskWriter(dirs.tasks);
    this.picker = new TaskPicker();
    this.planner = new Planner();
    this.stateStore = new StateStore(dirs.state);
    this.sessionStore = new SessionStore(dirs.state);
    this.skeletonStore = new SkeletonStore(dirs.state);
    this.askPlanStore =
      stores?.askPlanStore ??
      new AskPlanStore(plansDir, { tasksDir: dirs.tasks });
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

  // ── Task run (existing) ───────────────────────────────────────────────────

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

  // ── Skeleton run (new) ────────────────────────────────────────────────────

  async runSkeleton(goal: string, opts: SkeletonRunOptions = {}): Promise<void> {
    // 1. Generate skeleton
    console.log(chalk.bold("\n⚙  Generating plan skeleton..."));
    const skeleton = await this.planner.fromSkeletonSpec(goal, this.config.provider);
    const costEstimate = this.planner.estimateCost(skeleton.nodes.length);

    // 2. Persist before showing to user
    await this.skeletonStore.save(skeleton);

    // 3. User approval
    if (opts.onSkeletonReady) {
      const proceed = await opts.onSkeletonReady(skeleton, costEstimate);
      if (!proceed) {
        console.log(chalk.yellow("\nRun aborted. Skeleton saved for resume."));
        console.log(chalk.gray(`  Resume with: bee resume --skeleton ${skeleton.id}`));
        throw new UserAbortError();
      }
    }

    // 4. Set up skeleton logger
    const skeletonLogger = new SkeletonLogger(this.dirs.logs, skeleton.id);
    await skeletonLogger.log({ type: "skeleton:start", data: { goal, nodeCount: skeleton.nodes.length } });

    // 5. Execute nodes sequentially
    let handoffContext = "";
    const session = await this.sessionStore.init(this.config.provider);

    for (const node of skeleton.nodes) {
      // Skip already-done nodes (resume support)
      if (node.status === "done") {
        console.log(chalk.gray(`  ⏭  Skipping completed node: ${node.title}`));
        continue;
      }

      await this.skeletonStore.markNodeRunning(skeleton.id, node.id);
      opts.onProgress?.({ type: "node:start", nodeId: node.id, title: node.title });
      await skeletonLogger.log({ type: "node:start", nodeId: node.id, data: { title: node.title } });

      const nodeStart = Date.now();
      try {
        handoffContext = await this.runNode(
          node,
          handoffContext,
          session.active_provider,
          opts,
          skeletonLogger
        );
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        await this.skeletonStore.markNodeFailed(skeleton.id, node.id);
        await skeletonLogger.log({ type: "node:failed", nodeId: node.id, data: { error: e.message } });
        console.error(chalk.red(`\n✗ Node "${node.title}" failed.`));
        console.error(chalk.gray("  Run bee resume to retry from this node."));
        throw new NodeFailedError(node.id, node.title, e);
      }

      const elapsed = Date.now() - nodeStart;
      await this.skeletonStore.markNodeDone(skeleton.id, node.id);
      opts.onProgress?.({ type: "node:done", nodeId: node.id, elapsed, summary: handoffContext });
      await skeletonLogger.log({ type: "node:done", nodeId: node.id, data: { elapsed, summary: handoffContext } });

      // Pause between nodes if configured
      if (this.config.pause_between_nodes && node !== skeleton.nodes.at(-1)) {
        console.log(chalk.cyan(`\n── Node "${node.title}" complete ──`));
        console.log(chalk.gray(handoffContext));
        await this.waitForEnter(`\nContinue to next node? [Enter/n] `);
      }
    }

    await skeletonLogger.log({ type: "skeleton:done", data: { goal } });
    console.log(chalk.green(`\n✅ Skeleton complete: ${goal}`));
  }

  // ── Ask run (recursive plan) ──────────────────────────────────────────────

  /**
   * Full Ask flow:
   *   1. Recursively decompose goal → AskPlan tree
   *   2. Persist plan to .bee/plans/ask-{id}.json
   *   3. Present plan to user for confirmation
   *   4. Execute all leaf nodes, updating plan status throughout
   */
  async runAsk(goal: string, opts: AskRunOptions = {}): Promise<void> {
    // Phase 1: Decomposition
    console.log(chalk.bold("\n⚙  Decomposing plan..."));
    const plan = await this.planner.buildAskPlan(goal, this.config.provider);

    try {
      await this.askPlanStore.save(plan);
      console.log(chalk.gray(`  Plan saved: .bee/plans/ask-${plan.id}.json`));

      // Phase 2: Present plan + user approval
      if (opts.onPlanReady) {
        const proceed = await opts.onPlanReady(plan);
        if (!proceed) {
          await this.askPlanStore.updateStatus(plan.id, "planning");
          console.log(chalk.yellow("\nRun aborted. Plan saved — resume with: bee ask --resume " + plan.id));
          throw new UserAbortError();
        }
      }

      // Phase 3: Execute
      await this.askPlanStore.updateStatus(plan.id, "running");

      const session = await this.sessionStore.init(this.config.provider);
      let handoffContext = "";

      for (const node of plan.root_nodes) {
        handoffContext = await this.runAskNode(plan.id, node, handoffContext, session.active_provider, opts);
      }
      await this.askPlanStore.updateStatus(plan.id, "done");
      console.log(chalk.green(`\n✅ Ask plan complete: ${goal}`));
      console.log(chalk.gray(`  Plan: .bee/plans/ask-${plan.id}.json`));
    } catch (err) {
      if (err instanceof UserAbortError) {
        throw err;
      }
      await this.askPlanStore.updateStatus(plan.id, "failed");
      throw err;
    } finally {
      this.askPlanStore.setActivePlan(null);
    }
  }

  /**
   * Execute a single AskPlanNode.
   * If the node has sub_nodes, recurse into them.
   * Otherwise treat as a skeleton node: generate leaf tasks, execute, handoff.
   */
  private async runAskNode(
    planId: string,
    node: AskPlanNode,
    handoffContext: string,
    provider: string,
    opts: AskRunOptions
  ): Promise<string> {
    await this.askPlanStore.updateNodeStatus(planId, node.id, "running");

    try {
      if (node.sub_nodes && node.sub_nodes.length > 0) {
        // Branch node: recurse into sub-nodes
        console.log(chalk.bold(`\n▶ ${node.title}`));
        console.log(chalk.gray(`  ${node.description}`));

        for (const sub of node.sub_nodes) {
          handoffContext = await this.runAskNode(planId, sub, handoffContext, provider, opts);
        }
      } else {
        // Leaf node: generate + execute tasks (like skeleton runNode)
        const skNode = {
          id: node.id,
          title: node.title,
          description: node.description,
          acceptance_criteria: node.acceptance_criteria,
          depends_on: undefined,
          provider,
          status: "running" as const,
        };

        // No-op logger — Ask plan uses AskPlanStore for persistence, not JSONL
        const noopLogger: { log: (entry: Omit<SkeletonLogEntry, "ts">) => Promise<void> } = {
          log: async (_entry) => {},
        };

        const summary = await this.runNode(
          skNode,
          handoffContext,
          provider,
          opts,
          noopLogger as SkeletonLogger,
          async (taskIds) => {
            await this.askPlanStore.setNodeLeafTasks(planId, node.id, taskIds);
          },
        );

        // Record leaf task IDs (they were saved to .bee/tasks/ by TaskWriter)
        handoffContext = summary;
      }

      await this.askPlanStore.updateNodeStatus(planId, node.id, "done");
      return handoffContext;
    } catch (err) {
      await this.askPlanStore.updateNodeStatus(planId, node.id, "failed");
      // Wrap as NodeFailedError so ask.ts can handle it gracefully (same as runSkeleton)
      const e = err instanceof Error ? err : new Error(String(err));
      if (err instanceof NodeFailedError) throw err;
      throw new NodeFailedError(node.id, node.title, e);
    }
  }

  // ── Node execution (new) ──────────────────────────────────────────────────

  private async runNode(
    node: SkeletonNode,
    handoffContext: string,
    provider: string,
    opts: SkeletonRunOptions,
    skeletonLogger: SkeletonLogger,
    onLeafTasksGenerated?: (taskIds: string[]) => Promise<void>
  ): Promise<string> {
    console.log(chalk.bold(`\n▶ Node: ${node.title}`));
    console.log(chalk.gray(`  ${node.description}`));

    // 1. Generate leaf tasks
    const leafTasks = await this.planner.generateLeafTasks(node, handoffContext, provider);
    console.log(chalk.gray(`  Generated ${leafTasks.length} leaf task(s)`));
    await onLeafTasksGenerated?.(leafTasks.map((task) => task.task_id));

    // 2. Execute each leaf
    const completedGoals: string[] = [];
    for (let i = 0; i < leafTasks.length; i++) {
      const leaf = leafTasks[i]!;
      opts.onProgress?.({ type: "leaf:start", nodeId: node.id, leafId: leaf.task_id, goal: leaf.goal });
      await skeletonLogger.log({ type: "leaf:start", nodeId: node.id, leafId: leaf.task_id, data: { goal: leaf.goal } });

      console.log(chalk.gray(`  • [${i + 1}/${leafTasks.length}] ${leaf.goal}`));

      let success = false;
      try {
        await this.runTask(leaf, opts);
        success = true;
        completedGoals.push(leaf.goal);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        await skeletonLogger.log({ type: "leaf:failed", nodeId: node.id, leafId: leaf.task_id, data: { error: e.message } });
        throw e;
      }

      opts.onProgress?.({ type: "leaf:done", nodeId: node.id, leafId: leaf.task_id, success });
      await skeletonLogger.log({ type: "leaf:done", nodeId: node.id, leafId: leaf.task_id, data: { success } });
    }

    // 3. Verify node acceptance criteria (runtime_check_cmd if present)
    for (const criterion of node.acceptance_criteria) {
      // Only run criteria that look like shell commands (start with known tool names)
      if (checkCommand(criterion) === "allowed") {
        const { result } = await this.runCriterionCheck(criterion, opts);
        if (!result) {
          throw new Error(`Acceptance criterion failed: ${criterion}`);
        }
      }
    }

    // 4. Generate handoff summary
    const completedDesc = completedGoals.map((g, i) => `${i + 1}. ${g}`).join("\n");
    const summary = await this.planner.generateHandoffSummary(node.title, completedDesc);
    const cleanSummary = stripAnsi(summary);

    // 5. Update shared context for next node
    await this.sessionStore.updateContext(cleanSummary);

    return cleanSummary;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async runCriterionCheck(
    cmd: string,
    opts: SkeletonRunOptions
  ): Promise<{ result: boolean }> {
    if (checkCommand(cmd) === "confirm") {
      // Ask user if not in automatic mode
      if (opts.onDisallowedCommand) {
        const ok = await opts.onDisallowedCommand(cmd);
        if (!ok) return { result: false };
      } else {
        console.log(chalk.yellow(`  ⚠ Skipping unallowed criterion check: ${cmd}`));
        return { result: true }; // skip rather than fail
      }
    }

    try {
      const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      return { result: exitCode === 0 };
    } catch {
      return { result: false };
    }
  }

  private async waitForEnter(prompt: string): Promise<void> {
    process.stdout.write(prompt);
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const input = data.toString().trim();
        process.stdin.removeListener("data", onData);
        if (input.toLowerCase() === "n") {
          throw new UserAbortError();
        }
        resolve();
      };
      process.stdin.once("data", onData);
    });
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
    let isInPlanMode = false;
    // Track current provider (may switch mid-run on limit)
    let activeProvider = session.active_provider ?? this.config.provider;

    const onToolCall = (name: string, input: Record<string, unknown>): void => {
      if (name === "EnterPlanMode") {
        try {
          const plan = input as unknown as Plan;
          this.askPlanStore.setActivePlan(plan);
          isInPlanMode = true;
        } catch {
          // Ignore invalid plan payloads — loop must not enter error state
        }
      }
    };

    try {
      while (keepRunning) {
        // Execute
        const { result, record } = await this.executor.execute(
          { ...task, provider: activeProvider },
          tracer,
          logger,
          costTracker,
          attempt,
          onToolCall
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
    } finally {
      if (isInPlanMode) {
        this.askPlanStore.setActivePlan(null);
      }
    }
  }
}
