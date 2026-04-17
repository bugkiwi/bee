# README Verification Inventory

Source: `README.md` at repository root.

This document extracts README claims that describe project purpose, architecture, setup, environments, scripts, and developer workflows. Every row below is queued for verification against repository sources; no row is treated as confirmed here.

## Major README Sections

| README lines | Section | Operational scope |
|---|---|---|
| 3-5 | Front matter | Product purpose and core guarantees |
| 9-18 | Why bee? | Execution model and high-level guarantees |
| 22-31 | Install | Runtime requirement and install/build entrypoints |
| 35-58 | Quick Start | Primary CLI workflows |
| 62-108 | Interactive REPL | TUI features, labels, and slash-command workflows |
| 111-145 | How It Works | Task lifecycle, task contract, execution rules |
| 148-159 | Session Persistence | Storage path, session contents, provider binding behavior |
| 162-187 | Plugin Architecture | Plugin layers and custom plugin interface |
| 191-202 | Providers | Integration protocol and provider support matrix |
| 205-213 | Observability | Trace, log, cost, and replay behavior |
| 216-236 | Project Structure | Claimed directory layout and responsibilities |
| 240-249 | Development | Dev/test/lint/build workflows |
| 253-261 | Tech Stack | Runtime and library choices |
| 264-266 | License | Non-operational metadata |

## Verification Categories

| Category | README coverage | Verification source classes |
|---|---|---|
| Purpose and positioning | 3-5, 13-18 | `src/main.ts`, `src/cli/index.ts`, `src/agent/*`, `src/verifier/*`, `src/session/*`, tests |
| Setup and environment | 22-31 | `package.json`, `bunfig.toml`, `src/main.ts`, workspace config |
| CLI and developer workflows | 35-58, 89-107, 240-249 | `src/cli/*`, `package.json`, `src/tests/*` |
| Interactive REPL / TUI | 62-108 | `src/cli/repl-ink.tsx`, `src/cli/ui/*`, `src/cli/chat.ts`, `src/tests/app-ink.test.ts`, `src/tests/ui-content.test.ts` |
| Task model and verification | 111-145 | `src/schema/task.schema.ts`, `src/state/*`, `src/agent/*`, `src/verifier/*`, task tests |
| Session persistence | 148-159 | `src/session/manager.ts`, `src/state/session.ts`, `src/cli/chat.ts`, `src/tests/session.test.ts` |
| Architecture and plugins | 162-187 | `src/plugins/*`, `src/engine/*`, `BEE_PLUGIN_SPEC.md`, `BEE_SPEC.md`, plugin-related tests |
| Providers and integrations | 191-202 | `src/providers/*`, `src/types/config.ts`, ACP tests |
| Observability | 205-213 | `src/observability/*`, `src/cli/commands/replay.ts`, replay/logging tests |
| Repository structure | 216-236 | directory tree under `src/` and `.bee/` |
| Scripts and stack | 240-261 | `package.json`, dependency manifest, lockfile |
| Deployment | none stated | no README deployment claims to verify |

## Claim Queue

### Purpose and Positioning

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| P-01 | 3 | `bee` is a deterministic coding agent CLI. | Yes - code + tests | `src/main.ts`, `src/cli/index.ts`, `src/agent/loop.ts`, `src/tests/*` |
| P-02 | 3 | `bee` orchestrates Claude, Codex, and more. | Yes - code + config + tests | `src/providers/registry.ts`, `src/providers/*`, `src/types/config.ts`, `src/tests/chat.test.ts`, `src/tests/session.test.ts` |
| P-03 | 3 | `bee` uses task contracts. | Yes - code + schema | `src/schema/task.schema.ts`, `src/tasks/planner.ts`, `src/tasks/writer.ts`, `src/tests/task-schema.test.ts` |
| P-04 | 3 | `bee` provides state persistence. | Yes - code + runtime layout | `src/state/store.ts`, `src/state/session.ts`, `src/session/manager.ts`, `.bee/` runtime data |
| P-05 | 3 | `bee` enforces mandatory verification. | Yes - code + tests | `src/verifier/index.ts`, `src/agent/loop.ts`, `src/cli/commands/verify.ts`, verifier tests |
| P-06 | 5 | `bee` is not a chat tool. | Yes - code + workflow behavior | `src/cli/chat.ts`, `src/cli/repl-ink.tsx`, `src/agent/*`, `BEE_SPEC.md` |
| P-07 | 5 | `bee` is a task execution engine. | Yes - code + workflow behavior | `src/agent/loop.ts`, `src/engine/orchestrator.ts`, `src/tasks/*`, `src/verifier/*` |
| P-08 | 13 | Every coding request is treated as a structured task contract with steps, acceptance criteria, and a verification gate. | Yes - code + schema + tests | `src/tasks/planner.ts`, `src/schema/task.schema.ts`, `src/agent/loop.ts`, task-related tests |
| P-09 | 13 | Nothing is done until it is verified. | Yes - code + tests | `src/agent/loop.ts`, `src/verifier/index.ts`, `src/state/transitions.ts`, workflow tests |
| P-10 | 15 | `bee` is deterministic because all steps execute and early stops are disallowed. | Yes - code + tests | `src/agent/loop.ts`, `src/state/transitions.ts`, `src/tasks/picker.ts`, workflow tests |
| P-11 | 16 | `bee` is stateful because tasks survive restarts and resume where they left off. | Yes - code + runtime + tests | `src/state/store.ts`, `src/session/manager.ts`, `src/cli/commands/resume.ts`, `src/tests/session.test.ts` |
| P-12 | 17 | A task is only marked done after tests, lint, and typecheck pass. | Yes - code + tests | `src/verifier/index.ts`, `src/agent/loop.ts`, `src/cli/commands/verify.ts`, verifier tests |
| P-13 | 18 | `bee` is provider-agnostic and uses ACP to reach Claude Code, Codex, Kimi, and additional providers. | Yes - code + config + tests | `src/providers/acp/*`, `src/providers/registry.ts`, `src/types/config.ts`, ACP tests |

### Setup and Environment

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| S-01 | 25 | The project requires Bun. | Yes - scripts + runtime | `package.json`, `bun.lock`, `bunfig.toml`, shebang in `src/main.ts` |
| S-02 | 26-27 | Install/build flow is `bun install` then `bun run build`. | Yes - scripts | `package.json`, `bun.lock`, build output under `dist/` |
| S-03 | 30 | The app can be run directly with `bun src/main.ts`. | Yes - entrypoint code | `package.json`, `src/main.ts`, CLI tests |

### CLI and Developer Workflows

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| W-01 | 38-39 | Running `bee` with no args starts REPL mode. | Yes - code + tests | `src/main.ts`, `src/cli/repl-ink.tsx`, REPL tests |
| W-02 | 41-42 | `bee --resume <session-id>` resumes a previous session. | Yes - code + tests | `src/main.ts`, `src/session/manager.ts`, `src/tests/session.test.ts` |
| W-03 | 44-45 | `bee plan "implement user authentication"` is a valid way to plan a task. | Yes - CLI syntax + tests | `src/cli/index.ts`, `src/cli/commands/plan.ts`, CLI tests |
| W-04 | 47-48 | `bee run` executes the current plan/task work. | Yes - CLI command + workflow tests | `src/cli/index.ts`, `src/cli/commands/run.ts`, `src/agent/loop.ts` |
| W-05 | 50-51 | `bee resume` resumes interrupted task work. | Yes - CLI command + workflow tests | `src/cli/index.ts`, `src/cli/commands/resume.ts`, `src/state/*` |
| W-06 | 53-54 | `bee verify` verifies the current state. | Yes - CLI command + verifier | `src/cli/index.ts`, `src/cli/commands/verify.ts`, `src/verifier/*` |
| W-07 | 56-57 | `bee replay` replays past execution for debugging. | Yes - CLI command + replay implementation | `src/cli/index.ts`, `src/cli/commands/replay.ts`, `src/observability/replay.ts` |
| W-08 | 93 | `/plan <spec>` creates a structured task from a spec file. | Yes - REPL command + planner | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/cli/commands/plan.ts`, `src/tasks/planner.ts` |
| W-09 | 94 | `/run [task-id]` executes a task with mandatory verification. | Yes - REPL command + workflow | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/agent/loop.ts`, `src/verifier/index.ts` |
| W-10 | 95 | `/resume [task-id]` resumes interrupted work. | Yes - REPL command + workflow | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/cli/commands/resume.ts` |
| W-11 | 96 | `/verify <task-id>` runs tests, lint, and typecheck. | Yes - REPL command + verifier | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/verifier/index.ts` |
| W-12 | 97 | `/replay <task-id>` replays execution logs for debugging. | Yes - REPL command + replay | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/observability/replay.ts` |
| W-13 | 98 | `/status` and `/tasks` show task state. | Yes - REPL command behavior | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/tasks/picker.ts`, state tests |
| W-14 | 99 | `/provider` lists available providers. | Yes - REPL command + provider registry | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/providers/registry.ts` |
| W-15 | 100 | `/switch <provider>` switches the active provider. | Yes - REPL command + session behavior | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/session/manager.ts`, `src/state/session.ts` |
| W-16 | 101 | `/session` shows session state, token costs, and limit events. | Yes - REPL command + session model | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/session/manager.ts`, `src/state/session.ts` |
| W-17 | 102 | `/config` shows workspace config. | Yes - REPL command + config model | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/types/config.ts`, `.bee/config.json` |
| W-18 | 103 | `/logs [task-id]` shows execution logs. | Yes - REPL command + logs | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/observability/logger.ts` |
| W-19 | 104 | `/gain` shows RTK token savings analytics. | Yes - REPL command + RTK plugin | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/plugins/rtk.ts` |
| W-20 | 105 | `/chat clear` resets chat history. | Yes - REPL command + session/chat behavior | `src/cli/commands.ts`, `src/cli/repl-ink.tsx`, `src/cli/chat.ts` |
| W-21 | 106 | `/clear` clears the terminal. | Yes - REPL command behavior | `src/cli/commands.ts`, `src/cli/repl-ink.tsx` |
| W-22 | 107 | `!<command>` runs a shell command from the REPL. | Yes - REPL command behavior + command safety | `src/cli/repl-ink.tsx`, `src/utils/command-gate.ts`, `src/tests/command-gate.test.ts` |

### Interactive REPL / TUI

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| UI-01 | 64 | Running `bee` with no arguments opens a terminal UI built with Ink. | Yes - code + deps | `src/main.ts`, `src/cli/repl-ink.tsx`, `src/cli/ui/App.tsx`, `package.json` |
| UI-02 | 68 | Assistant responses render with markdown formatting, including bold, code blocks, and lists. | Yes - UI code + tests | `src/cli/ui/markdown.ts`, `src/cli/ui/App.tsx`, `src/tests/app-ink.test.ts` |
| UI-03 | 69 | File read/write/edit tool calls show inline unified diffs with line counts. | Yes - UI code + tests | `src/utils/diff-preview.ts`, `src/cli/chat.ts`, `src/cli/ui/ThinkingCollapsibleLine.tsx`, `src/tests/diff-preview.test.ts` |
| UI-04 | 70 | Thinking blocks are collapsible. | Yes - UI code + tests | `src/cli/ui/content.ts`, `src/cli/ui/ThinkingCollapsibleLine.tsx`, `src/tests/ui-content.test.ts`, `src/tests/app-ink.test.ts` |
| UI-05 | 70 | Pressing `Enter` on a focused thinking block expands or collapses it. | Yes - UI event handling + tests | `src/cli/ui/App.tsx`, `src/cli/ui/ThinkingCollapsibleLine.tsx`, interaction tests |
| UI-06 | 71 | Each tool call shows an emoji indicator and parameters at a glance. | Yes - UI code | `src/cli/chat.ts`, `src/cli/repl-ink.tsx`, `src/cli/ui/App.tsx` |
| UI-07 | 72 | `Ctrl+V` pastes clipboard images directly into the prompt. | Yes - UI code + platform behavior | `src/cli/ui/App.tsx`, `src/cli/screenshot.ts`, image-paste tests if present |
| UI-08 | 73 | `↑` and `↓` navigate previous prompts. | Yes - UI input handling + tests | `src/cli/ui/App.tsx`, `src/cli/ui/content.ts`, input history tests |
| UI-09 | 74 | Slash commands auto-complete with smart matching. | Yes - UI input handling | `src/cli/commands.ts`, `src/cli/ui/App.tsx`, REPL tests |
| UI-10 | 75 | Mouse support allows click-to-focus and scroll history. | Yes - UI input handling + tests | `src/cli/ui/terminal.ts`, `src/cli/ui/click-behavior.ts`, `src/cli/ui/App.tsx`, mouse/click tests |
| UI-11 | 76 | The status line shows active provider, model, session ID, and message count. | Yes - UI/session integration | `src/cli/ui/StatusBar.tsx`, `src/cli/ui/App.tsx`, `src/session/manager.ts`, UI tests |
| UI-12 | 82 | Content label `ASK` is used for the user prompt and displayed in yellow. | Yes - UI label rendering | `src/cli/ui/content.ts`, `src/cli/ui/App.tsx`, `src/tests/ui-content.test.ts` |
| UI-13 | 83 | Content label `ANSWER` is used for assistant responses and rendered as markdown. | Yes - UI label rendering | `src/cli/ui/content.ts`, `src/cli/ui/App.tsx`, `src/cli/ui/markdown.ts`, `src/tests/ui-content.test.ts` |
| UI-14 | 84 | Content label `THINKING` is gray and represents a collapsible reasoning block. | Yes - UI label rendering + collapsible logic | `src/cli/ui/content.ts`, `src/cli/ui/ThinkingCollapsibleLine.tsx`, tests |
| UI-15 | 85 | Content label `TOOL` is cyan and includes parameters and diff preview. | Yes - UI label rendering + tool rendering | `src/cli/ui/content.ts`, `src/cli/chat.ts`, `src/utils/diff-preview.ts` |
| UI-16 | 86 | Content label `ERROR` is red for error output. | Yes - UI label rendering | `src/cli/ui/content.ts`, `src/cli/ui/App.tsx` |
| UI-17 | 87 | Content label `SYSTEM` is dim for status messages. | Yes - UI label rendering | `src/cli/ui/App.tsx`, `src/cli/repl-ink.tsx`, UI tests |

### Task Model and Verification

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| T-01 | 113 | Every task follows a strict lifecycle. | Yes - state machine + tests | `src/state/transitions.ts`, `src/schema/task.schema.ts`, state-machine tests |
| T-02 | 115-118 | The lifecycle is `pending -> running -> verifying -> done`, with failure leading to `retrying`. | Yes - state machine + tests | `src/state/transitions.ts`, `src/agent/loop.ts`, `src/tests/state-machine.test.ts` |
| T-03 | 122 | All work is represented as a structured task. | Yes - schema + planner | `src/schema/task.schema.ts`, `src/tasks/planner.ts`, `src/tasks/writer.ts` |
| T-04 | 124-136 | A task contract includes `task_id`, `goal`, `steps`, `acceptance_criteria`, `tests_required`, and `status`. | Yes - schema + planner | `src/schema/task.schema.ts`, `src/tasks/planner.ts`, `src/tests/task-schema.test.ts` |
| T-05 | 128-131 | Each step includes `id`, `desc`, and `status`. | Yes - schema | `src/schema/task.schema.ts`, planner/task tests |
| T-06 | 133 | Acceptance criteria are stored as a list on the task. | Yes - schema + planner | `src/schema/task.schema.ts`, `src/tasks/planner.ts` |
| T-07 | 134 | The task model has a `tests_required` flag. | Yes - schema + verifier | `src/schema/task.schema.ts`, `src/verifier/index.ts` |
| T-08 | 141 | Every step executes; skipping is disallowed. | Yes - agent/workflow code | `src/agent/loop.ts`, `src/tasks/picker.ts`, workflow tests |
| T-09 | 142 | Mid-task confirmation prompts are disallowed. | Yes - workflow code + config behavior | `src/agent/loop.ts`, `src/cli/repl-ink.tsx`, `BEE_SPEC.md` |
| T-10 | 143 | Verification is mandatory before a task reaches `done`. | Yes - agent/verifier code | `src/agent/loop.ts`, `src/verifier/index.ts`, `src/state/transitions.ts` |
| T-11 | 143 | Verification specifically consists of tests, lint, and typecheck. | Yes - verifier code | `src/verifier/index.ts`, `src/verifier/checks/tests.ts`, `src/verifier/checks/lint.ts`, `src/verifier/checks/typecheck.ts` |
| T-12 | 144 | Failures trigger automatic retry. | Yes - retry code + tests | `src/agent/retrier.ts`, `src/agent/loop.ts`, `src/tests/retrier.test.ts` |
| T-13 | 144 | Retry behavior uses backoff. | Yes - retry code + config | `src/agent/retrier.ts`, `src/types/config.ts`, retry tests |

### Session Persistence

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| SP-01 | 150 | Sessions are stored globally under `~/.bee/projects/<path-hash>/sessions/<session-id>.json`. | Yes - session code + tests | `src/session/manager.ts`, `src/tests/session.test.ts` |
| SP-02 | 152 | Session files include provider bindings with native session IDs for each provider. | Yes - session model + tests | `src/session/manager.ts`, `src/cli/chat.ts`, `src/tests/session.test.ts` |
| SP-03 | 152 | Provider bindings avoid context rebuilding between messages. | Yes - chat/session integration | `src/cli/chat.ts`, `src/session/manager.ts`, chat/session tests |
| SP-04 | 153 | Session files include a lightweight transcript for UI resume. | Yes - session model + tests | `src/session/manager.ts`, `src/tests/session.test.ts` |
| SP-05 | 154 | Session files track token usage and cost per provider. | Yes - session model + tests | `src/session/manager.ts`, `src/state/session.ts`, `src/tests/session.test.ts` |
| SP-06 | 155 | Session files include limit events for rate limits. | Yes - session model + tests | `src/session/manager.ts`, `src/state/session.ts`, limit/session tests |
| SP-07 | 156 | Session files include message count and last active timestamp. | Yes - session model + tests | `src/session/manager.ts`, `src/tests/session.test.ts` |
| SP-08 | 158 | Claude, Codex, and Kimi each own their conversation thread natively. | Yes - provider/session integration | `src/session/manager.ts`, `src/cli/chat.ts`, `src/providers/*`, session tests |
| SP-09 | 158 | Switching providers creates a new binding. | Yes - session behavior + tests | `src/session/manager.ts`, `src/state/session.ts`, `src/tests/session.test.ts` |
| SP-10 | 158 | Resuming reuses the stored native session ID. | Yes - session behavior + tests | `src/session/manager.ts`, `src/cli/chat.ts`, `src/tests/session.test.ts` |

### Architecture and Plugins

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| A-01 | 164 | `bee` is built on a layered plugin system. | Yes - code + specs | `src/plugins/*`, `src/engine/*`, `BEE_PLUGIN_SPEC.md`, `BEE_SPEC.md` |
| A-02 | 168 | A Context Selector plugin picks only relevant files for the task. | Yes - plugin implementation + tests | `src/plugins/context-selector.ts`, plugin tests/specs |
| A-03 | 169 | A Repo Index (RAG) plugin provides semantic code search via embeddings. | Yes - plugin implementation/specs | `src/plugins/*`, `BEE_PLUGIN_SPEC.md`, `BEE_SPEC.md` |
| A-04 | 170 | A Task Planner plugin converts natural language into structured steps. | Yes - planner implementation | `src/tasks/planner.ts`, `src/engine/orchestrator.ts`, planner tests |
| A-05 | 171 | A Diff Engine plugin generates diffs instead of full file rewrites. | Yes - plugin implementation + tests | `src/plugins/diff-engine.ts`, `src/utils/diff-preview.ts`, diff tests |
| A-06 | 172 | A State Manager plugin persists and resumes task state. | Yes - state implementation | `src/state/*`, `src/session/*`, `src/engine/*` |
| A-07 | 173 | A Test Generator plugin writes tests before implementation. | Yes - plugin implementation | `src/plugins/test-generator.ts`, specs/tests |
| A-08 | 174 | A Test Runner plugin runs tests and auto-fixes on failure. | Yes - plugin implementation | `src/plugins/test-runner.ts`, `src/verifier/*`, tests |
| A-09 | 175 | A Critic plugin reviews output for edge cases and errors. | Yes - plugin implementation | `src/plugins/critic.ts`, specs/tests |
| A-10 | 176 | A Verifier plugin is the final gate and runs tests, lint, and typecheck. | Yes - plugin/verifier implementation | `src/verifier/index.ts`, `src/verifier/checks/*`, `src/agent/loop.ts` |
| A-11 | 178-186 | Custom plugins implement the `BeePlugin` interface with `name`, `init`, `execute`, and optional `verify`. | Yes - code | `src/plugins/base.ts` |

### Providers and Integrations

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| PR-01 | 193 | `bee` talks to agents via ACP. | Yes - provider transport code + tests | `src/providers/acp/*`, `src/cli/chat.ts`, ACP tests |
| PR-02 | 197 | Claude Code is supported. | Yes - provider implementation + tests | `src/providers/claude/*`, `src/providers/registry.ts`, provider tests |
| PR-03 | 198 | Codex is supported. | Yes - provider implementation + tests | `src/providers/codex/*`, `src/providers/registry.ts`, provider tests |
| PR-04 | 199 | Kimi is supported. | Yes - provider implementation + tests | `src/providers/kimi/*`, `src/providers/registry.ts`, `src/tests/kimi-acp.test.ts` |
| PR-05 | 200 | OpenAI Agents support is planned. | Yes - roadmap/spec presence | `BEE_SPEC.md`, `BEE_PLUGIN_SPEC.md`, provider directory |
| PR-06 | 201 | Ollama support is planned. | Yes - roadmap/spec presence | `BEE_SPEC.md`, `BEE_PLUGIN_SPEC.md`, provider directory |

### Observability

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| O-01 | 207-209 | Every execution emits a `trace_id`. | Yes - observability code + tests | `src/observability/tracer.ts`, `src/observability/logger.ts`, replay/logging tests |
| O-02 | 209 | `trace_id` is unique per task run. | Yes - tracer implementation | `src/observability/tracer.ts`, `src/utils/id.ts` |
| O-03 | 210 | Structured logs are written to `/.bee/logs`. | Yes - workspace + logger code | `src/utils/workspace.ts`, `src/observability/logger.ts`, `.bee/logs/` |
| O-04 | 211 | Token cost is tracked per step. | Yes - observability/session code | `src/observability/cost.ts`, `src/agent/loop.ts`, `src/state/session.ts` |
| O-05 | 212 | Full replay support exists for debugging. | Yes - replay implementation | `src/observability/replay.ts`, `src/cli/commands/replay.ts`, replay tests |

### Repository Structure

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| FS-01 | 221-222 | `src/cli/` contains the REPL, Ink UI components, and commands. | Yes - directory contents | `src/cli/` tree |
| FS-02 | 222 | `src/cli/ui/` contains `App.tsx`, content rendering, and types. | Yes - directory contents | `src/cli/ui/` tree |
| FS-03 | 223 | `src/agent/` contains the agent loop. | Yes - directory contents | `src/agent/` tree |
| FS-04 | 224 | `src/providers/` contains Claude, Codex, and Kimi adapters. | Yes - directory contents | `src/providers/` tree |
| FS-05 | 225 | `src/plugins/` contains the plugin registry and built-ins. | Yes - directory contents | `src/plugins/` tree |
| FS-06 | 226 | `src/tasks/` contains the task contract engine. | Yes - directory contents | `src/tasks/` tree |
| FS-07 | 227 | `src/state/` contains the state machine and persistence logic. | Yes - directory contents | `src/state/` tree |
| FS-08 | 228 | `src/session/` contains the session store and provider bindings. | Yes - directory contents | `src/session/` tree |
| FS-09 | 229 | `src/verifier/` contains the verification gate. | Yes - directory contents | `src/verifier/` tree |
| FS-10 | 230 | `src/observability/` contains tracing, cost, and logs. | Yes - directory contents | `src/observability/` tree |
| FS-11 | 231 | `src/types/` contains shared type definitions. | Yes - directory contents | `src/types/` tree |
| FS-12 | 232 | `src/utils/` contains diff preview helpers and utilities. | Yes - directory contents | `src/utils/` tree |
| FS-13 | 233 | `src/tests/` contains the test suite. | Yes - directory contents | `src/tests/` tree |
| FS-14 | 234 | `src/schema/` contains Zod schemas. | Yes - directory contents | `src/schema/` tree |
| FS-15 | 235 | `.bee/` contains local runtime data, config, tasks, state, and logs. | Yes - runtime layout | `.bee/`, `src/utils/workspace.ts` |

### Scripts and Tech Stack

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| ST-01 | 243 | `bun run dev` starts watch mode. | Yes - scripts | `package.json` |
| ST-02 | 244 | `bun test` runs tests. | Yes - scripts | `package.json` |
| ST-03 | 245 | `bun run typecheck` runs the TypeScript check. | Yes - scripts | `package.json`, `tsconfig.json` |
| ST-04 | 246 | `bun run lint` runs Biome linting. | Yes - scripts | `package.json` |
| ST-05 | 247 | `bun run lint:fix` auto-fixes lint issues. | Yes - scripts | `package.json` |
| ST-06 | 248 | `bun run build` compiles the project to a binary. | Yes - scripts + build output | `package.json`, `dist/` |
| ST-07 | 255 | The runtime is Bun. | Yes - scripts + manifest | `package.json`, `bun.lock`, `bunfig.toml`, `src/main.ts` |
| ST-08 | 256 | The language is TypeScript. | Yes - source layout + config | `tsconfig.json`, `src/**/*.ts`, `src/**/*.tsx` |
| ST-09 | 257 | The UI uses Ink plus React terminal components. | Yes - deps + source | `package.json`, `src/cli/repl-ink.tsx`, `src/cli/ui/*` |
| ST-10 | 258 | Validation uses Zod. | Yes - deps + source | `package.json`, `src/schema/*`, `src/tasks/planner.ts` |
| ST-11 | 259 | The CLI uses Commander. | Yes - deps + source | `package.json`, `src/cli/index.ts` |
| ST-12 | 260 | Biome is the configured linter. | Yes - deps + scripts | `package.json` |

### Deployment

| ID | README ref | Claim extracted from README | Needs confirmation | Queue against repository sources |
|---|---|---|---|---|
| D-01 | n/a | No explicit deployment claims were found in the current README. | No queue item required | n/a |
