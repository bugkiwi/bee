import type { IProvider } from "../types/provider.ts";
import type { WorkspaceConfig } from "../types/config.ts";
import { ClaudeProvider } from "./claude/index.ts";
import { CodexProvider } from "./codex/index.ts";
import { KimiProvider } from "./kimi/index.ts";

export class ProviderRegistry {
  private readonly providers = new Map<string, IProvider>();

  constructor(config: WorkspaceConfig) {
    const useRtk = config.use_rtk ?? false;

    this.providers.set(
      "claude",
      new ClaudeProvider({ model: config.model, timeoutMs: config.timeout_ms, useRtk, editMode: config.edit_mode ?? true })
    );
    this.providers.set(
      "codex",
      new CodexProvider({ model: config.model, timeoutMs: config.timeout_ms, useRtk })
    );

    this.providers.set(
      "kimi",
      new KimiProvider({ timeoutMs: config.timeout_ms, useRtk })
    );
  }

  get(name: string): IProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown provider: "${name}". Available: ${[...this.providers.keys()].join(", ")}`
      );
    }
    return provider;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
