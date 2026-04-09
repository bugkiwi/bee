/**
 * Global session manager — stores sessions under ~/.bee/projects/<path-hash>/
 *
 * Modeled after Claude's ~/.claude/projects/ pattern:
 *   ~/.bee/projects/-Users-gkiwi-Work-bee/sessions/<session-id>.json
 *
 * Each session binds to a provider's native conversation so we never rebuild
 * the full prompt. It also stores a lightweight transcript for UI resume.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { ensureDir, readJsonFile, writeJsonFile, listFiles } from "../utils/fs.ts";
import { normalizeProviderName } from "../types/config.ts";
import type { TranscriptLineMeta } from "../types/transcript.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProviderBinding {
  /** Provider name: "claude" | "codex" | "kimi" */
  provider: string;
  /** Native session/conversation ID from the provider CLI */
  nativeId: string | null;
  /** Highest transcript sequence this provider has already seen */
  syncedThrough: number;
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
  /** Monotonic transcript sequence counter across the full session */
  transcriptSeq: number;
  /** Persisted chat transcript lines for session resume rendering. */
  transcript: BeeTranscriptLine[];
}

export interface BeeTranscriptLine {
  type: "user" | "assistant" | "tool" | "thinking" | "error";
  text: string;
  meta?: TranscriptLineMeta;
  at: string;
  seq: number;
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

  private normalizeSessionShape(raw: BeeSession): BeeSession {
    const activeProvider = normalizeProviderName(raw.activeProvider);
    const rawTranscript = Array.isArray((raw as Partial<BeeSession>).transcript)
      ? (raw as Partial<BeeSession>).transcript as BeeTranscriptLine[]
      : [];
    const transcript = rawTranscript.map((line, index) => ({
      ...line,
      seq: typeof line.seq === "number" ? line.seq : index + 1,
    }));
    const transcriptSeq =
      typeof (raw as Partial<BeeSession>).transcriptSeq === "number"
        ? Math.max((raw as Partial<BeeSession>).transcriptSeq!, transcript.at(-1)?.seq ?? 0)
        : (transcript.at(-1)?.seq ?? 0);
    const rawProviders = raw.providers ?? {};
    const providers = Object.entries(rawProviders).reduce<Record<string, ProviderBinding>>(
      (acc, [name, binding]) => {
        const provider = normalizeProviderName(name);
        const prefersNormalizedNativeId = name !== provider && binding.nativeId !== null;
        const normalizedBinding: ProviderBinding = {
          ...binding,
          provider,
          syncedThrough:
            typeof binding.syncedThrough === "number"
              ? Math.min(binding.syncedThrough, transcriptSeq)
              : (provider === activeProvider ? transcriptSeq : 0),
        };
        const existing = acc[provider];
        if (!existing) {
          acc[provider] = normalizedBinding;
          return acc;
        }
        acc[provider] = {
          ...existing,
          nativeId: prefersNormalizedNativeId
            ? normalizedBinding.nativeId
            : (existing.nativeId ?? normalizedBinding.nativeId),
          syncedThrough: Math.max(existing.syncedThrough, normalizedBinding.syncedThrough),
          tokens: Math.max(existing.tokens, normalizedBinding.tokens),
          cost: Math.max(existing.cost, normalizedBinding.cost),
          lastActive:
            existing.lastActive >= normalizedBinding.lastActive
              ? existing.lastActive
              : normalizedBinding.lastActive,
        };
        return acc;
      },
      {}
    );
    return {
      ...raw,
      activeProvider,
      providers,
      transcriptSeq,
      transcript,
    };
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
          syncedThrough: 0,
          tokens: 0,
          cost: 0,
          lastActive: now,
        },
      },
      messageCount: 0,
      transcriptSeq: 0,
      transcript: [],
    };
    await this.save(session);
    return session;
  }

  /** Load a session by ID. Returns null if not found. */
  async load(sessionId: string): Promise<BeeSession | null> {
    try {
      const raw = await readJsonFile<BeeSession>(this._sessionFile(sessionId));
      return this.normalizeSessionShape(raw);
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
        const s = this.normalizeSessionShape(await readJsonFile<BeeSession>(f));
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
        sessions.push(this.normalizeSessionShape(await readJsonFile<BeeSession>(f)));
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
        syncedThrough: 0,
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
        syncedThrough: 0,
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

  /** Append transcript lines to a session and persist. */
  async appendTranscript(session: BeeSession, lines: BeeTranscriptLine[]): Promise<void> {
    if (lines.length === 0) return;
    if (!Array.isArray(session.transcript)) session.transcript = [];
    if (typeof session.transcriptSeq !== "number") {
      session.transcriptSeq = session.transcript.at(-1)?.seq ?? 0;
    }
    session.transcript.push(
      ...lines.map((line) => ({
        ...line,
        seq: ++session.transcriptSeq,
      }))
    );
    const MAX_LINES = 2000;
    if (session.transcript.length > MAX_LINES) {
      session.transcript = session.transcript.slice(-MAX_LINES);
    }
    await this.save(session);
  }

  /** Reset conversation continuity for a session (history + native IDs + counters). */
  async resetConversation(session: BeeSession): Promise<void> {
    session.messageCount = 0;
    session.transcriptSeq = 0;
    session.transcript = [];
    for (const provider of Object.values(session.providers)) {
      provider.nativeId = null;
      provider.syncedThrough = 0;
      provider.lastActive = new Date().toISOString();
    }
    await this.save(session);
  }

  /** Mark a provider as having seen the transcript through the current sequence. */
  async markProviderSynced(session: BeeSession, provider: string, seq = session.transcriptSeq): Promise<void> {
    if (!session.providers[provider]) {
      session.providers[provider] = {
        provider,
        nativeId: null,
        syncedThrough: 0,
        tokens: 0,
        cost: 0,
        lastActive: new Date().toISOString(),
      };
    }
    session.providers[provider]!.syncedThrough = Math.max(0, Math.min(seq, session.transcriptSeq));
    session.providers[provider]!.lastActive = new Date().toISOString();
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
