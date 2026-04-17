# Developer Workflows

This document reflects the workflows that are actually wired into the current repository configuration and source code. It does not assume undocumented CI, deployment, or environment conventions.

## Toolchain and prerequisites

| Requirement | Current source of truth | Notes |
| --- | --- | --- |
| Bun | `package.json`, `#!/usr/bin/env bun` in `src/main.ts` | Required for install, dev, build, test, and running the CLI from source. |
| TypeScript | `tsconfig.json` | `bunx tsc --noEmit` is the effective typecheck command. |
| Interactive TTY | `src/main.ts` | `bee` with no subcommand requires a TTY. Non-interactive environments must use subcommands such as `bee run`. |
| Provider CLIs for task execution | `src/providers/claude/index.ts`, `src/providers/codex/index.ts`, `src/providers/kimi/index.ts` | `bee run`, `bee ask`, and `bee skeleton` shell out directly to `claude`, `codex`, and `kimi`. |
| ACP bridge commands for REPL chat | `src/providers/acp/commands.ts`, `src/cli/chat.ts` | Interactive chat uses ACP-backed commands, not the direct task-execution commands. |
| Optional `rtk` binary | `src/plugins/rtk.ts` | Only used when `use_rtk` is enabled and `rtk --version` succeeds. |

### Provider prerequisites

Task execution and REPL chat have different command paths:

| Surface | Claude | Codex | Kimi |
| --- | --- | --- | --- |
| `bee run` / `bee ask` / `bee skeleton` | `claude ...` | `codex exec ...` | `kimi --print ...` |
| Interactive chat / REPL session | `npx -y @zed-industries/claude-code-acp` | `npx -y @zed-industries/codex-acp` | `kimi acp` |

Authentication expectations come from `src/cli/chat.ts`:

- Claude: authenticate the local CLI with `claude auth login`.
- Codex: export `OPENAI_API_KEY`.
- Kimi: export `MOONSHOT_API_KEY`.

### Environment and config caveats

- No `.env.example` is committed. `.env*` is ignored by Git, but this repository does not ship a template.
- `BEE_NO_INTRO=1` suppresses the interactive intro banner.
- `CI` disables the intro banner and, in practice, pushes you toward subcommands because interactive mode requires a TTY.
- `BEE_ENABLE_MOUSE=0` disables mouse capture in the Ink UI.
- `WorkspaceConfigSchema` accepts `kimi_api_key`, `kimi_model`, and `kimi_base_url`, but the current provider execution path does not read those fields.

## Setup and bootstrap

### Install dependencies

```bash
bun install
```

### Initialize a workspace

Run the CLI initializer from source or from the compiled binary:

```bash
bun src/main.ts init
# or, after building:
./dist/bee init
```

`bee init` currently:

- creates `.bee/`
- creates `.bee/config.json` if it does not already exist
- health-checks `claude --version` and `codex --version`

It does not health-check `kimi`, even though the registry and planner support it elsewhere.

### First interactive run

After `bee init`, `.bee/config.json` is written without `_initialized: true`. The next interactive `bee` run opens the Ink first-run wizard and persists:

- `provider`
- `use_rtk`
- `edit_mode`
- `use_plugins`
- `_initialized`

If `.bee/config.json` does not exist, `bee` falls back to `DEFAULT_CONFIG` and starts without creating the config file first.

### Runtime directories

The workspace root is the nearest parent containing `.bee/`. Runtime paths are:

| Path | Purpose |
| --- | --- |
| `.bee/config.json` | Workspace config. |
| `.bee/tasks/` | Planned task JSON files. |
| `.bee/state/` | Task state JSON, skeleton checkpoints, and `.session.json`. |
| `.bee/logs/` | Trace logs, crash logs, skeleton logs, and `costs.jsonl`. |
| `.bee/plans/` | Recursive ask-plan JSON files. |
| `~/.bee/projects/<path-hash>/sessions/` | Global interactive chat session resume files. |

`getWorkspaceDirs()` also migrates legacy top-level `tasks/`, `state/`, and `logs/` directories into `.bee/` when possible.

## Local development workflows

### Run from source

```bash
bun src/main.ts
```

This starts the Ink REPL when a TTY is available. `bee --resume [session-id]` is also interactive-only.

### Watch mode during development

```bash
bun run dev
```

This maps to:

```bash
bun --watch src/main.ts
```

### Build the distributable binary

```bash
bun run build
```

This maps to:

```bash
bun build src/main.ts --compile --outfile dist/bee
```

The only compiled deployment artifact in the repository is:

```bash
dist/bee
```

### Clean build output

```bash
bun run clean
```

This removes `dist/`.

## Task and release-oriented CLI workflows

### Plan a task from a spec file

```bash
bun src/main.ts plan path/to/spec.md --provider codex
```

Behavior:

- reads the spec file from disk
- generates a structured task via `Planner.fromSpec(...)`
- writes `.bee/tasks/<task-id>.json`

The `plan` implementation supports `claude`, `codex`, and `kimi` in the planner, but the Commander help text still says `claude|codex`.

### Run pending work

```bash
bun src/main.ts run
bun src/main.ts run task_123 --provider claude -v
bun src/main.ts run task_123 --dry-run
```

Behavior:

- loads tasks from `.bee/tasks/`
- initializes or updates `.bee/state/<task-id>.json`
- writes trace logs to `.bee/logs/<trace-id>.jsonl`
- writes token/cost records to `.bee/logs/costs.jsonl`
- verifies successful runs before marking tasks done

### Resume interrupted work

```bash
bun src/main.ts resume
bun src/main.ts resume task_123
```

Behavior:

- if there is exactly one incomplete skeleton checkpoint in `.bee/state/skeleton-*.json`, `resume` auto-resumes it
- otherwise it resumes non-`done` and non-`failed` tasks from `.bee/tasks/`

Current mismatch to be aware of:

- user-facing messages mention `bee resume --skeleton <id>`, but the CLI does not declare a `--skeleton` option

### Verify task outputs

```bash
bun src/main.ts verify
bun src/main.ts verify task_123
bun src/main.ts verify --all
```

Behavior:

- loads tasks from `.bee/tasks/`
- runs the repository verifier logic for each selected task
- updates `.bee/state/<task-id>.json` with verification timestamps and errors

### Replay task logs

```bash
bun src/main.ts replay task_123
bun src/main.ts replay task_123 --trace-id trace_abc
```

Behavior:

- reads `.bee/logs/*.jsonl`
- replays the newest matching trace when `--trace-id` is omitted

### Execute a skeleton plan

```bash
bun src/main.ts skeleton "document the release process"
bun src/main.ts skeleton "document the release process" --provider kimi --pause
```

Behavior:

- creates a plan skeleton
- checkpoints it to `.bee/state/skeleton-<id>.json`
- logs progress to `.bee/logs/skeleton-<id>.jsonl`
- generates leaf tasks and executes them sequentially

### Recursively decompose and execute a goal

```bash
bun src/main.ts ask "document the release process"
bun src/main.ts ask "document the release process" --provider codex
```

Behavior:

- writes `.bee/plans/ask-<id>.json`
- expands leaf nodes into `.bee/tasks/<task-id>.json`
- executes the leaf tasks and updates the ask-plan status as it goes

Current mismatch to be aware of:

- abort messaging references `bee ask --resume <id>`, but the CLI does not define an `ask --resume` flag

## Validation workflows

### Package scripts

| Task | Command |
| --- | --- |
| Test suite | `bun test` |
| Test watch mode | `bun test --watch` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Lint with fixes | `bun run lint:fix` |
| Build | `bun run build` |

### Effective verifier behavior

The verifier used by `bee run` and `bee verify` is not identical to the `package.json` scripts:

| Check | Actual command | When it runs |
| --- | --- | --- |
| Tests | `bun test --bail` | Only when the task has `tests_required: true`. |
| Typecheck | `bunx tsc --noEmit` | Runs whenever `tsconfig.json` exists. |
| Lint | `bunx biome check .` or `bunx eslint .` | Only when a linter config file exists. |
| Runtime check | `sh -c <runtime_check_cmd>` | Only when the task JSON sets `runtime_check_cmd`. |

Important current behavior:

- The repository exposes manual Biome scripts in `package.json`.
- The automatic verifier skips lint in the current repo because there is no committed `biome.json`, `biome.jsonc`, `.eslintrc.js`, `.eslintrc.json`, `eslint.config.js`, or `eslint.config.mjs`.

If you want lint as part of contributor validation today, run it manually with:

```bash
bun run lint
```

## Deployment and release workflow

There is no committed deployment automation in the repository:

- no `.github/workflows/`
- no `Dockerfile`
- no `Makefile`
- no release or publish script in `package.json`

The real release path implied by the repository is manual:

1. Install dependencies with `bun install`.
2. Validate with `bun test`, `bun run typecheck`, and any manual lint/build checks you require.
3. Build the standalone binary with `bun run build`.
4. Distribute `dist/bee` by whatever external release mechanism you use.

That compiled binary is the only deployable artifact currently defined by the repo.
