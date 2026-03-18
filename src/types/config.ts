export interface WorkspaceConfig {
  provider: string;
  model?: string;
  max_retries: number;
  timeout_ms: number;
  backoff_ms: number;
  backoff_multiplier: number;
  price_table?: Record<string, { input_per_1m: number; output_per_1m: number }>;
  acp_base_url?: string;
  // First-run flag: set to true after wizard completes
  _initialized?: boolean;
  // RTK plugin
  use_rtk?: boolean;
  // Plugin pipeline (context-selector, diff-engine, critic)
  use_plugins?: boolean;
  // Run providers in edit mode (claude: no --print, uses stdin; allows file edits)
  edit_mode?: boolean;
  // Kimi (Moonshot AI) provider
  kimi_api_key?: string;
  kimi_model?: string;
  kimi_base_url?: string;
}

export const DEFAULT_CONFIG: WorkspaceConfig = {
  provider: "claude",
  max_retries: 3,
  timeout_ms: 300_000,
  backoff_ms: 5_000,
  backoff_multiplier: 2.0,
  price_table: {
    "claude-sonnet-4-6": { input_per_1m: 3.0, output_per_1m: 15.0 },
    "claude-opus-4-6": { input_per_1m: 15.0, output_per_1m: 75.0 },
    "claude-haiku-4-5-20251001": { input_per_1m: 0.8, output_per_1m: 4.0 },
    "codex-mini-latest": { input_per_1m: 1.5, output_per_1m: 6.0 },
  },
};
