import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "../utils/fs.ts";

export interface ProviderSession {
  provider: string;
  /** Accumulated context messages for continuity across switches */
  context_summary?: string;
  tokens_used: number;
  cost_usd: number;
  last_active: string;
}

export interface ProjectSession {
  session_id: string;
  started_at: string;
  active_provider: string;
  /** Context shared across provider switches */
  shared_context: string;
  providers: Record<string, ProviderSession>;
  /** Error log for limit/failure events */
  limit_events: Array<{
    provider: string;
    kind: "rate_limit" | "budget_limit" | "api_error" | "timeout";
    message: string;
    timestamp: string;
    switched_to?: string;
  }>;
}

export class SessionStore {
  private readonly sessionFile: string;
  private session: ProjectSession | null = null;

  constructor(stateDir: string) {
    this.sessionFile = join(stateDir, ".session.json");
  }

  async load(): Promise<ProjectSession | null> {
    try {
      this.session = await readJsonFile<ProjectSession>(this.sessionFile);
      return this.session;
    } catch {
      return null;
    }
  }

  async init(provider: string): Promise<ProjectSession> {
    const existing = await this.load();
    if (existing) {
      this.session = existing;
      return existing;
    }
    this.session = {
      session_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      active_provider: provider,
      shared_context: "",
      providers: {
        [provider]: {
          provider,
          tokens_used: 0,
          cost_usd: 0,
          last_active: new Date().toISOString(),
        },
      },
      limit_events: [],
    };
    await this.save();
    return this.session;
  }

  async switchProvider(to: string, reason?: string): Promise<void> {
    if (!this.session) return;
    const from = this.session.active_provider;

    this.session.active_provider = to;
    if (!this.session.providers[to]) {
      this.session.providers[to] = {
        provider: to,
        tokens_used: 0,
        cost_usd: 0,
        last_active: new Date().toISOString(),
      };
    }

    if (reason) {
      this.session.limit_events.push({
        provider: from,
        kind: "rate_limit",
        message: reason,
        timestamp: new Date().toISOString(),
        switched_to: to,
      });
    }
    await this.save();
  }

  async recordLimitEvent(
    provider: string,
    kind: ProjectSession["limit_events"][number]["kind"],
    message: string
  ): Promise<void> {
    if (!this.session) return;
    this.session.limit_events.push({
      provider,
      kind,
      message,
      timestamp: new Date().toISOString(),
    });
    await this.save();
  }

  async updateContext(summary: string): Promise<void> {
    if (!this.session) return;
    this.session.shared_context = summary;
    await this.save();
  }

  async addTokens(provider: string, tokens: number, cost: number): Promise<void> {
    if (!this.session) return;
    if (!this.session.providers[provider]) {
      this.session.providers[provider] = {
        provider,
        tokens_used: 0,
        cost_usd: 0,
        last_active: new Date().toISOString(),
      };
    }
    this.session.providers[provider]!.tokens_used += tokens;
    this.session.providers[provider]!.cost_usd += cost;
    this.session.providers[provider]!.last_active = new Date().toISOString();
    await this.save();
  }

  getSharedContext(): string {
    return this.session?.shared_context ?? "";
  }

  getActiveProvider(): string | null {
    return this.session?.active_provider ?? null;
  }

  getCurrent(): ProjectSession | null {
    return this.session;
  }

  private async save(): Promise<void> {
    if (!this.session) return;
    await writeJsonFile(this.sessionFile, this.session);
  }
}
