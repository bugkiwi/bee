# Runtime Architecture

## Current Runtime Entrypoints

| Surface | Declared In | Runtime Target | Notes |
|---|---|---|---|
| `bee` executable | `package.json` `bin.bee` | `src/main.ts` | Primary app entrypoint during local development. |
| `bun src/main.ts` | `README.md`, direct invocation | `src/main.ts` | Same runtime path as the package bin. |
| `bun run dev` | `package.json` `scripts.dev` | `bun --watch src/main.ts` | Watch-mode wrapper around the same entrypoint. |
| `dist/bee` | `package.json` `scripts.build` | compiled from `src/main.ts` | Production binary output from `bun build src/main.ts --compile --outfile dist/bee`. |

There is no HTTP server bootstrap, no `listen()` call, and no web-router entrypoint in the current application. The live runtime surface is a Bun CLI with two modes:

1. Interactive Ink REPL mode
2. Non-interactive Commander subcommands

## Startup Dispatch

`src/main.ts` is the single startup dispatcher.

1. Bun starts `src/main.ts` via the shebang `#!/usr/bin/env bun`.
2. `main()` resolves the workspace root with `findWorkspaceRoot()` and derives runtime directories with `getWorkspaceDirs()`.
3. Crash logging is initialized with `createCrashLogger()` and `installProcessCrashHandlers()`.
4. `parseInteractiveModeArgs(process.argv.slice(2))` chooses between interactive mode and subcommand mode.

Interactive mode is selected when:

- no CLI args are provided, or
- `--resume` is provided without other subcommand arguments

Interactive startup then does the following:

1. Load `.bee/config.json` through `loadConfig()`
2. Run the first-run Ink wizard when config exists but `_initialized` is false
3. Require a TTY via `canUseInkRepl()`
4. Call `runRepl()` from `src/cli/repl-ink.tsx`

Command mode does the following:

1. Build a `commander` program with `buildCli()`
2. Register subcommands from `src/cli/index.ts`
3. Call `program.parse(process.argv)`

## Command Routes

`src/cli/index.ts` is the command router for non-interactive mode.

| Command | Handler | Downstream Runtime Path |
|---|---|---|
| `bee init` | `runInit()` | creates `.bee/`, writes default config, checks provider binaries |
| `bee plan <spec-file>` | `runPlan()` | `Planner.fromSpec()` -> `TaskWriter.write()` |
| `bee run [task-id]` | `runRun()` | `AgentLoop.run()` |
| `bee resume [task-id]` | `runResume()` | `AgentLoop.run()` or `AgentLoop.runSkeleton()` |
| `bee verify [task-id]` | `runVerify()` | `Verifier.runAll()` + `VerificationReporter` |
| `bee replay <task-id>` | `runReplay()` | `ReplayReader.replay()` |
| `bee skeleton <goal>` | `runSkeleton()` | `AgentLoop.runSkeleton()` |
| `bee ask <goal>` | `runAsk()` | `AgentLoop.runAsk()` |

## Interactive Runtime Flow

`runRepl()` in `src/cli/repl-ink.tsx` is the interactive entrypoint.

It wires together these runtime objects:

- `ChatSession` for interactive provider conversations and transcript persistence
- `AskPlanStore` for live ask-plan updates and plan-preview hydration
- `App` from `src/cli/ui/App.tsx` as the root Ink component
- `handleCommand()` as the slash-command dispatcher

Interactive boot sequence:

1. Create `ChatSession(config, { projectPath: process.cwd() })`
2. Resume or create a persisted Bee session through `chatSession.initSession()`
3. Load crash notices and task-status lines for initial UI state
4. Create one shared `AskPlanStore` instance for the whole REPL session
5. Render `<App ... />` with callbacks for commands, provider switching, and exit

Inside `App`, `handleSubmit()` routes user input into three distinct execution paths:

| Input Shape | Runtime Path |
|---|---|
| `!shell command` | direct `Bun.spawn(["sh", "-c", shellCmd])` from the UI |
| `/slash command` | `onCommand()` -> `handleCommand()` in `src/cli/repl-ink.tsx` |
| plain chat text | `chatSession.send(message, hooks)` |

The slash-command layer is not separate business logic. It reuses the same underlying services used by the non-interactive CLI:

- `/run` -> `AgentLoop.run()`
- `/plan` -> `runPlan()`
- `/verify` -> `Verifier.runAll()`
- `/resume` -> `AgentLoop.run()`
- `/replay` -> `ReplayReader.replay()`
- `/provider` and `/switch` -> `switchProvider()`
- `/session` -> reads `.bee/state/.session.json` through `SessionStore`

`App` also has a planning-intent route that is only present in interactive mode:

1. `ChatSession` prefixes each user request with a plan-classifier instruction
2. A provider may respond with `<bee:plan goal="..."/>`
3. `App` captures that via `onPlanIntent`
4. `App` invokes `onCommand("__plan_intent__", [goal])`
5. `handleCommand()` routes that hidden command to `runAsk(..., { autoConfirm: true })`

## Interactive Provider Wiring

`ChatSession` in `src/cli/chat.ts` is the runtime bridge between the Ink UI and provider backends.

The current shipped interactive path prefers ACP session continuation for all three supported providers:

- `claude`
- `codex`
- `kimi`

The live path is:

1. `App` calls `chatSession.send()`
2. `ChatSession` chooses `sendViaAcp()` because `shouldUseAcp()` returns true for the shipped providers
3. `sendViaLocalAcp()` opens a `StdioAcpClient`
4. The client loads or creates a provider-side session with `session/load` or `session/new`
5. `buildProviderRequest()` injects transcript handoff from the persisted Bee session when switching providers
6. ACP notifications stream text, thinking, and tool events back into the UI hooks
7. Provider-native session IDs are bound back into `SessionManager`

Fallback direct CLI implementations also exist in `ChatSession`:

- `sendClaude()` uses `claude --session-id` and `claude --resume`
- `sendCodex()` uses `codex exec` and `codex exec resume`

Those methods are implemented and usable, but they are not the default interactive path while ACP is enabled for the shipped providers.

## Task Execution Runtime

`AgentLoop` in `src/agent/loop.ts` is the central runtime orchestrator for all non-chat work.

Its constructor wires together:

- `TaskLoader`
- `TaskWriter`
- `TaskPicker`
- `Planner`
- `StateStore`
- `SessionStore`
- `SkeletonStore`
- `AskPlanStore`
- `TaskExecutor`
- `Retrier`
- `Verifier`
- `VerificationReporter`

### Standard Task Run

The runtime path for `bee run` and `/run` is:

1. `AgentLoop.run()` loads all task JSON files from `.bee/tasks/`
2. `TaskPicker.pickAll()` selects non-terminal tasks, or a specific task is chosen by ID
3. `runTask()` creates a `Tracer`, `Logger`, and `CostTracker`
4. `StateStore.init()` creates or loads `.bee/state/<task-id>.json`
5. `SessionStore.init()` creates or loads `.bee/state/.session.json`
6. The task status is transitioned to `running` through the state machine and written back via `TaskWriter.update()`
7. `TaskExecutor.execute()` invokes the configured provider
8. `Verifier.runAll()` runs quality gates
9. Success or failure is persisted back to task and state files
10. `Retrier` handles retry timing when verification or provider execution fails

### Provider Execution

`TaskExecutor` in `src/agent/executor.ts` is the execution bridge between `AgentLoop` and provider CLIs.

Its runtime flow is:

1. Resolve the provider through `ProviderRegistry`
2. Build the task prompt with `buildPrompt()`
3. Optionally enrich the task through the plugin pipeline
4. Execute the provider binary in the task working directory
5. Stream provider events into the task logger and console
6. Record tokens and costs
7. Optionally run post-processing plugins

The plugin hooks currently on the execution path are:

- `ContextSelector` before provider execution
- `DiffEngine` after successful provider output
- `Critic` after successful provider output

`ProviderRegistry` currently instantiates:

- `ClaudeProvider`
- `CodexProvider`
- `KimiProvider`

Each provider eventually shells out through `Bun.spawn(...)`:

- `ClaudeProvider` -> `claude`
- `CodexProvider` -> `codex exec`
- `KimiProvider` -> `kimi`

## Planning And Decomposition Runtime

`Planner` in `src/tasks/planner.ts` is the planning service used by `plan`, `skeleton`, and `ask`.

### `plan`

`runPlan()` performs:

1. read spec file
2. `Planner.fromSpec()`
3. provider-backed JSON generation for one `Task`
4. `TaskWriter.write()` into `.bee/tasks/<task-id>.json`

### `skeleton`

`AgentLoop.runSkeleton()` performs:

1. `Planner.fromSkeletonSpec()` to create a phase list
2. `SkeletonStore.save()` to checkpoint `skeleton-<id>.json`
3. sequential node execution through `runNode()`

`runNode()` performs:

1. `Planner.generateLeafTasks()` for the current phase
2. `runTask()` for each generated leaf task
3. shell-verifiable acceptance checks for command-like criteria
4. `Planner.generateHandoffSummary()` for the next node
5. `SessionStore.updateContext()` so later nodes can inherit the shared summary

### `ask`

`AgentLoop.runAsk()` performs:

1. `Planner.buildAskPlan()` for recursive decomposition
2. `AskPlanStore.save()` into `.bee/plans/ask-<id>.json`
3. recursive execution via `runAskNode()`
4. leaf execution through the same `runNode()` and `runTask()` pipeline used by skeleton mode

`AskPlanStore` also hydrates ask-plan files into displayable `Plan` objects so the Ink UI can render live progress through `activePlan`.

## Verification And Completion Gates

The current completion gate is `Verifier.runAll()` in `src/verifier/index.ts`.

For each task it runs:

1. tests when `task.tests_required` is true
2. lint
3. typecheck
4. optional runtime command when `task.runtime_check_cmd` is set

This verifier is used in two places:

- automatically inside `AgentLoop.runTask()` before a task is marked done
- explicitly by `bee verify` and `/verify`

## Persistence Layout

Workspace-local runtime state is discovered through `getWorkspaceDirs()` in `src/utils/workspace.ts`.

| Location | Role |
|---|---|
| `.bee/config.json` | workspace config |
| `.bee/tasks/*.json` | planned and generated tasks |
| `.bee/state/<task-id>.json` | per-task execution state |
| `.bee/state/.session.json` | orchestration session, shared context, provider usage, and limit events |
| `.bee/state/skeleton-*.json` | skeleton checkpoints |
| `.bee/logs/*.jsonl` | task trace logs |
| `.bee/logs/costs.jsonl` | cost ledger |
| `.bee/plans/ask-*.json` | recursive ask plans |

There are two distinct session systems in the live runtime:

| Session Layer | Backing File(s) | Used By | Purpose |
|---|---|---|---|
| `SessionStore` | `.bee/state/.session.json` | `AgentLoop`, REPL `/session`, provider failover | task-orchestration session state inside the workspace |
| `SessionManager` | `~/.bee/projects/<path-hash>/sessions/<session-id>.json` | `ChatSession` | interactive chat transcript, provider bindings, and resume support across REPL sessions |

## Observability Wiring

The active runtime observability path is:

1. `src/main.ts` installs crash handlers
2. `AgentLoop.runTask()` creates a `Tracer` and `Logger`
3. trace events are written as JSONL under `.bee/logs/`
4. `CostTracker` appends token-cost records to `.bee/logs/costs.jsonl`
5. `ReplayReader` replays those logs for `bee replay` and `/replay`

Skeleton runs also emit structured JSONL through `SkeletonLogger`.

## Modules Present But Not On The Current Runtime Path

The `src/engine/` modules are not part of the live startup or execution path identified above.

- `src/engine/orchestrator.ts`
- `src/engine/dependencyResolver.ts`
- `src/engine/subChatLauncher.ts`

These files are implemented and covered by tests, but they are not referenced from `src/main.ts`, `src/cli/index.ts`, `src/cli/repl-ink.tsx`, `src/cli/chat.ts`, or `src/agent/loop.ts`. The current runtime is centered on `AgentLoop`, not `runOrchestrator()`.
