# Repository Inventory

## Top-Level Structure

| Path | Role |
|---|---|
| `.bee/` | Local workspace data and runtime state: config, logs, plans, tasks, and state files. |
| `.claude/` | Claude-local editor and launch settings. |
| `dist/` | Compiled CLI output (`dist/bee`). |
| `docs/` | Project documentation and inventories. |
| `node_modules/` | Installed dependencies. |
| `src/` | Application source, tests, schemas, and shared types. |
| `BEE_SPEC.md` | Product and architecture specification. |
| `BEE_PLUGIN_SPEC.md` | Plugin-system specification. |
| `CLAUDE.md` | Project instructions for Claude workflows. |
| `TODOS.md` | Project task notes. |
| `README.md` | Primary project overview and usage guide. |
| `package.json` | Single-package manifest, scripts, dependencies, and CLI entrypoint. |
| `bun.lock` | Bun lockfile. |
| `bunfig.toml` | Bun test configuration (`timeout = 30000`). |
| `tsconfig.json` | TypeScript compiler settings for strict ESM React/TSX code. |
| `.gitignore` | Git ignore rules. |

## Source Modules

| Module | Responsibility |
|---|---|
| `src/main.ts` | Bun entrypoint; selects interactive Ink REPL vs Commander CLI mode, loads workspace config, installs crash handling. |
| `src/cli/` | Command-line surface: subcommands, REPL plumbing, terminal output, first-run wizard, screenshots. |
| `src/cli/ui/` | Ink terminal UI components such as the app shell, input panel, queue panel, markdown rendering, status bar, and terminal helpers. |
| `src/components/` | Shared presentational React/Ink components including task trees, plan nodes, badges, progress bars, and subchat panels. |
| `src/agent/` | Task execution loop, executor logic, and retry behavior. |
| `src/engine/` | Higher-level orchestration, dependency resolution, and subchat task launching. |
| `src/tasks/` | Task loading, planning, picking, and writing. |
| `src/state/` | State machine, transitions, actions, task/session state, and persistence helpers. |
| `src/session/` | Session manager for persisted provider bindings and transcript metadata. |
| `src/providers/` | Provider abstraction plus Claude, Codex, Kimi, and ACP transport implementations. |
| `src/plugins/` | Built-in plugin contracts and implementations such as context selector, critic, diff engine, test generator, test runner, and RTK. |
| `src/context/` | Context payload schema, serialization, and provider-specific adapters/fixtures for Anthropic, OpenAI, and Gemini-style context. |
| `src/schema/` | Zod schemas for config, state, tasks, ask-plan, and skeleton data. |
| `src/types/` | Shared TypeScript domain types for plans, providers, tasks, sessions, transcripts, and verification. |
| `src/observability/` | Crash logging, tracing, replay, cost tracking, and structured logs. |
| `src/verifier/` | Verification gate and individual checks for tests, lint, typecheck, and runtime commands. |
| `src/utils/` | Generic helpers for filesystem access, IDs, prompts, streams, timeouts, workspace discovery, command gating, and diff previews. |
| `src/tests/` | Bun test suite covering CLI, UI, providers, planning, orchestration, state, verification, and utilities. |

## Primary Technologies And Tooling

| Category | In Use |
|---|---|
| Runtime and package manager | Bun (`bun.lock`, Bun scripts, `#!/usr/bin/env bun`) |
| Languages | TypeScript and TSX |
| Module system | ESM (`"type": "module"`) |
| UI framework | React 19 with Ink 6 for terminal UI |
| CLI framework | Commander |
| Validation and schemas | Zod |
| Terminal styling | Chalk, `cli-table3`, `@inkjs/ui` |
| Linting and formatting | Biome (`bunx biome check src/`) |
| Type checking | TypeScript (`tsc --noEmit`) |
| Testing | `bun test` with Bun test runner and `bunfig.toml` timeout config |
| Build output | `bun build src/main.ts --compile --outfile dist/bee` |

## Notable Manifest-Level Dependencies

### Runtime

- `ink`
- `react`
- `@inkjs/ui`
- `commander`
- `zod`
- `chalk`
- `cli-table3`

### Development

- `typescript`
- `@biomejs/biome`
- `@types/bun`
- `@types/react`
- `react-devtools-core`

## Repository Shape Summary

This repository is a single Bun package for a terminal-first coding-agent CLI named `bee`. The codebase centers on a React/Ink TUI, a Commander-based CLI, provider adapters for Claude/Codex/Kimi over ACP-style transports, a task/state/orchestration core, and a verification layer that runs tests, lint, and type checks before work is considered complete.
