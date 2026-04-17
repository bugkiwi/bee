# 🐝 bee

**Deterministic coding agent CLI. Orchestrates Claude, Codex, and more — with task contracts, state persistence, and mandatory verification.**

> Not a chat tool. A task execution engine.

---

## Why bee?

Most AI coding tools are chat wrappers. You prompt, they respond, you verify manually, and hope nothing breaks.

`bee` is different. It treats every coding request as a **structured task contract** with defined steps, acceptance criteria, and a verification gate. Nothing is done until it's verified.

- **Deterministic** — all steps execute, no early stops
- **Stateful** — tasks survive restarts, resume where they left off
- **Verified** — tests + lint + typecheck must pass before a task is marked done
- **Provider-agnostic** — Claude Code, Codex, Kimi, and more via ACP

---

## Install

```bash
# Requires Bun
bun install
bun run build

# Or run directly
bun src/main.ts
```

---

## Quick Start

```bash
# Interactive REPL (no args = REPL mode)
bee

# Resume a previous session
bee --resume <session-id>

# Plan a task
bee plan "implement user authentication"

# Execute the plan
bee run

# Resume an interrupted task
bee resume

# Verify current state
bee verify

# Replay past execution for debugging
bee replay
```

---

## Interactive REPL

Running `bee` with no arguments opens a full-featured terminal UI built with [Ink](https://github.com/vadimdemedes/ink) (React for the terminal).

### UI Features

- **Markdown rendering** — assistant responses render with full markdown formatting (bold, code blocks, lists, etc.)
- **Diff previews** — tool calls that read/write/edit files show inline unified diffs with line counts
- **Thinking blocks** — collapsible reasoning blocks; press `Enter` on a focused block to expand/collapse
- **Tool tracking** — each tool call shows an emoji indicator and parameters at a glance
- **Image paste** — `Ctrl+V` pastes clipboard images directly into the prompt
- **Input history** — `↑`/`↓` to navigate previous prompts
- **Auto-completion** — `/` commands complete with smart matching
- **Mouse support** — click to focus, scroll history
- **Status line** — shows active provider, model, session ID, and message count

### Content Labels

| Label | Color | Description |
|---|---|---|
| `ASK` | Yellow | Your prompt |
| `ANSWER` | Default | Assistant response (markdown rendered) |
| `THINKING` | Gray | Reasoning block (collapsible) |
| `TOOL` | Cyan | Tool call with parameters and diff preview |
| `ERROR` | Red | Error output |
| `SYSTEM` | Dim | Status messages |

### REPL Commands

| Command | Description |
|---|---|
| `/plan <spec>` | Create a structured task from a spec file |
| `/run [task-id]` | Execute a task with mandatory verification |
| `/resume [task-id]` | Resume interrupted work |
| `/verify <task-id>` | Run tests + lint + typecheck |
| `/replay <task-id>` | Replay execution logs for debugging |
| `/status`, `/tasks` | View task state |
| `/provider` | List available providers |
| `/switch <provider>` | Switch active provider |
| `/session` | View session state, token costs, limit events |
| `/config` | View workspace config |
| `/logs [task-id]` | View execution logs |
| `/gain` | Show token savings analytics (RTK) |
| `/chat clear` | Reset chat history |
| `/clear` | Clear terminal |
| `!<command>` | Run a shell command |

---

## How It Works

Every task follows a strict lifecycle:

```
pending → running → verifying → done
                 ↘ failed → retrying
```

### Task Contract

All work is defined as a structured task:

```json
{
  "task_id": "auth-001",
  "goal": "implement JWT authentication",
  "steps": [
    { "id": 1, "desc": "define schema", "status": "pending" },
    { "id": 2, "desc": "implement middleware", "status": "pending" },
    { "id": 3, "desc": "write tests", "status": "pending" }
  ],
  "acceptance_criteria": ["all tests pass", "lint clean", "typecheck clean"],
  "tests_required": true,
  "status": "pending"
}
```

### Execution Rules

- Every step executes — no skipping
- No mid-task confirmation prompts
- Verification (tests + lint + typecheck) is mandatory before `done`
- Failures trigger automatic retry with backoff

---

## Session Persistence

Sessions are stored globally at `~/.bee/projects/<path-hash>/sessions/<session-id>.json` and include:

- **Provider bindings** — native session IDs for each provider (no context rebuilding between messages)
- **Transcript** — lightweight chat history for UI resume
- **Token usage and cost** per provider
- **Limit events** — when providers hit rate limits
- **Message count** and last active timestamp

Provider session binding means Claude, Codex, and Kimi each own their conversation thread natively. Switching providers creates a new binding; resuming uses the stored native session ID.

---

## Plugin Architecture

bee is built on a layered plugin system:

| Layer | Plugin | Role |
|---|---|---|
| Context | Context Selector | Picks only relevant files for the task |
| Context | Repo Index (RAG) | Semantic code search via embeddings |
| Execution | Task Planner | Converts natural language → structured steps |
| Execution | Diff Engine | Generates diffs, not full file rewrites |
| Execution | State Manager | Persists and resumes task state |
| Quality | Test Generator | Writes tests before implementation |
| Quality | Test Runner | Runs tests, auto-fixes on failure |
| Quality | Critic | Reviews output for edge cases and errors |
| Quality | Verifier | Final gate: tests + lint + typecheck |

Custom plugins implement a simple interface:

```ts
interface BeePlugin {
  name: string
  init(ctx: Context): Promise<void>
  execute(input: unknown, ctx: Context): Promise<unknown>
  verify?(output: unknown): Promise<boolean>
}
```

---

## Providers

bee talks to agents via ACP (Agent Communication Protocol):

| Provider | Status |
|---|---|
| Claude Code | Supported |
| Codex | Supported |
| Kimi | Supported |
| OpenAI Agents | Planned |
| Ollama | Planned |

---

## Observability

Every execution emits:

- `trace_id` — unique ID per task run
- Structured logs → `/.bee/logs`
- Token cost tracking per step
- Full replay support for debugging

---

## Development

```bash
bun run dev        # Watch mode
bun test           # Run tests
bun run typecheck  # TypeScript check
bun run lint       # Biome lint
bun run lint:fix   # Auto-fix lint issues
bun run build      # Compile to binary
```

---

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **UI**: [Ink](https://github.com/vadimdemedes/ink) + React (terminal components)
- **Validation**: [Zod](https://zod.dev)
- **CLI**: [Commander](https://github.com/tj/commander.js)
- **Linter**: [Biome](https://biomejs.dev)

---

## License

MIT
