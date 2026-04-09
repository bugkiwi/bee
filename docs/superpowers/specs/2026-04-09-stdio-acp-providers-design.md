# Stdio ACP Providers Design

Date: 2026-04-09

## Goal

Replace Bee's mixed provider transport model with a single local `stdio ACP` model for:

- `claude`
- `codex`
- `kimi`

This change removes:

- HTTP ACP support via `acp_base_url`
- the dedicated `kimi` ACP bridge path
- provider-native chat transport fallbacks for these three providers

## User-Facing Outcome

- Bee keeps the same provider names: `claude`, `codex`, `kimi`
- Bee talks to all three providers through local ACP subprocesses
- provider switching still works through the existing UI
- session continuation stays provider-scoped through ACP session ids

## Transport Design

Bee will replace the current `AcpClient(baseUrl)` HTTP client with a local stdio ACP transport.

The new ACP layer will:

- spawn one configured command per provider
- speak ACP JSON-RPC over the child process stdio
- support `initialize`, `session/new`, `session/load`, `session/prompt`
- stream ACP updates back into the existing `ChatRenderHooks`
- persist returned ACP `sessionId` values using the existing Bee session store

Default provider commands:

- `claude`: `npx -y @zed-industries/claude-code-acp`
- `codex`: `npx -y @zed-industries/codex-acp`
- `kimi`: `kimi acp`

## Configuration Design

`WorkspaceConfig` will stop using `acp_base_url` as a transport switch.

New config surface:

- `acp_commands?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>`
- `acp_agent_names?: Record<string, string>` remains for agent naming overrides when needed

Rules:

- if `acp_commands[provider]` exists, use it
- otherwise use the built-in defaults for `claude`, `codex`, `kimi`
- unknown providers are not supported by the stdio ACP path in this change

## Runtime Flow

For each chat turn:

1. Resolve the local ACP command for the active provider.
2. Start or reuse a provider-scoped stdio ACP session runtime.
3. If Bee already has a stored ACP session id, issue `session/load`; otherwise `session/new`.
4. Send the prompt via `session/prompt`.
5. Forward ACP streaming updates into the existing Ink render hooks.
6. Persist the resulting ACP session id back to Bee's session state.

The runtime will be provider-scoped, not shared across providers.

## Code Shape

Expected structural changes:

- replace the HTTP-only ACP client with a transport-neutral ACP runtime interface
- add a stdio ACP transport implementation under `src/providers/acp/`
- update `ChatSession.send()` so `claude`, `codex`, and `kimi` all flow through the same ACP path
- remove the dedicated `runKimiAcpPrompt` chat path from `ChatSession`
- remove `claude-acp` from provider registry; the visible provider names remain `claude`, `codex`, `kimi`

## Error Handling

- child-process spawn failures surface as provider errors in the transcript
- malformed ACP messages fail the active turn and include stderr detail when available
- session load failure falls back to a fresh ACP session only when the failure clearly indicates a missing session
- hard process crashes are logged through the existing crash logger

## Testing

Coverage required before merge:

- unit tests for ACP command resolution defaults and overrides
- unit tests for stdio ACP message parsing and session id persistence
- chat-session tests proving all three providers use the unified ACP path
- regression coverage showing `kimi` no longer uses its dedicated bridge path
- typecheck and focused test suite for chat/provider integration

## Non-Goals

- no HTTP ACP fallback
- no support for arbitrary third-party providers in this change
- no remote ACP bridge or network transport
- no UI change to provider names or provider picker behavior
