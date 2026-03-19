/**
 * Global session manager — stores sessions under ~/.bee/projects/<path-hash>/
 *
 * Modeled after Claude's ~/.claude/projects/ pattern:
 *   ~/.bee/projects/-Users-gkiwi-Work-bee/sessions/<session-id>.json
 *
 * Each session binds to a provider's native conversation so we never rebuild
 * the full prompt.  Core fields only — no message history stored here.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { ensureDir, readJsonFile, writeJsonFile, listFiles } from "../utils/fs.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProviderBinding {
  /** Provider name: "claude" | "codex" | "kimi" */
  provider: string;
  /** Native session/conversation ID from the provider CLI */
  nativeId: string | null;
  /** Tokens consumed on this provider within this session */
  tokens: number;
  /** USD cost on this provider within this session */
  cost: number;
  /** Last time this provider was used */
  lastActive: string;
}

export interface BeeSession {
  /** UUID for this bee session */
  id: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last activity */
  updatedAt: string;
  /** Absolute path of the project root */
  projectPath: string;
  /** Currently active provider name */
  activeProvider: string;
  /** Per-provider native session bindings */
  providers: Record<string, ProviderBinding>;
  /** Total user messages sent in this session */
  messageCount: number;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

/** Convert an absolute path to a Claude-style hash: /Users/foo/Work/bar → -Users-foo-Work-bar */
export function projectPathHash(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

function globalBeeDir(): string {
  return join(homedir(), ".bee");
}

// Session dir/file resolution uses instance methods (_sessionsDir, _sessionFile)
// to support the baseDir override for testing.

// ─── SessionManager ─────────────────────────────────────────────────────────

export class SessionManager {
  private projectPath: string;
  private _baseDir: string | null;

  /**
   * @param projectPath Absolute path of the project
   * @param baseDir     Override the global ~/.bee directory (for testing)
   */
  constructor(projectPath: string, baseDir?: string) {
    this.projectPath = projectPath;
    this._baseDir = baseDir ?? null;
  }

  private get _sessionsDir(): string {
    const base = this._baseDir ?? globalBeeDir();
    return join(base, "projects", projectPathHash(this.projectPath), "sessions");
  }

  private _sessionFile(sessionId: string): string {
    return join(this._sessionsDir, `${sessionId}.json`);
  }

  /** Create a new session and persist it. */
  async create(provider: string): Promise<BeeSession> {
    const now = new Date().toISOString();
    const session: BeeSession = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      projectPath: this.projectPath,
      activeProvider: provider,
      providers: {
        [provider]: {
          provider,
          nativeId: null,
          tokens: 0,
          cost: 0,
          lastActive: now,
        },
      },
      messageCount: 0,
    };
    await this.save(session);
    return session;
  }

  /** Load a session by ID. Returns null if not found. */
  async load(sessionId: string): Promise<BeeSession | null> {
    try {
      return await readJsonFile<BeeSession>(this._sessionFile(sessionId));
    } catch {
      return null;
    }
  }

  /** Load the most recent session (by updatedAt). Returns null if none. */
  async loadLatest(): Promise<BeeSession | null> {
    const files = await listFiles(this._sessionsDir, ".json");
    if (files.length === 0) return null;

    let latest: BeeSession | null = null;
    for (const f of files) {
      try {
        const s = await readJsonFile<BeeSession>(f);
        if (!latest || s.updatedAt > latest.updatedAt) latest = s;
      } catch { /* skip corrupted */ }
    }
    return latest;
  }

  /** List all sessions (newest first). */
  async list(): Promise<BeeSession[]> {
    const files = await listFiles(this._sessionsDir, ".json");
    const sessions: BeeSession[] = [];
    for (const f of files) {
      try {
        sessions.push(await readJsonFile<BeeSession>(f));
      } catch { /* skip corrupted */ }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Persist session to disk. */
  async save(session: BeeSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await ensureDir(this._sessionsDir);
    await writeJsonFile(this._sessionFile(session.id), session);
  }

  /** Bind a provider's native session ID (e.g. claude --session-id UUID). */
  async bindNativeId(session: BeeSession, provider: string, nativeId: string): Promise<void> {
    if (!session.providers[provider]) {
      session.providers[provider] = {
        provider,
        nativeId,
        tokens: 0,
        cost: 0,
        lastActive: new Date().toISOString(),
      };
    } else {
      session.providers[provider]!.nativeId = nativeId;
    }
    await this.save(session);
  }

  /** Record token/cost usage for a provider. */
  async addUsage(session: BeeSession, provider: string, tokens: number, cost: number): Promise<void> {
    const binding = session.providers[provider];
    if (binding) {
      binding.tokens += tokens;
      binding.cost += cost;
      binding.lastActive = new Date().toISOString();
    }
    await this.save(session);
  }

  /** Switch active provider. */
  async switchProvider(session: BeeSession, to: string): Promise<void> {
    session.activeProvider = to;
    if (!session.providers[to]) {
      session.providers[to] = {
        provider: to,
        nativeId: null,
        tokens: 0,
        cost: 0,
        lastActive: new Date().toISOString(),
      };
    }
    await this.save(session);
  }

  /** Increment message count. */
  async recordMessage(session: BeeSession): Promise<void> {
    session.messageCount++;
    await this.save(session);
  }

  /** Delete a session file. */
  async delete(sessionId: string): Promise<void> {
    const path = this._sessionFile(sessionId);
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
    } catch { /* already gone */ }
  }
}
