import type { WorkspaceConfig } from "../../types/config.ts";

export const DEFAULT_ACP_AGENT_NAMES: Record<string, string> = {
	claude: "claude-code",
	codex: "codex",
	kimi: "kimi",
};

export function resolveAcpAgentName(
	provider: string,
	config?: Pick<WorkspaceConfig, "acp_agent_names">,
): string {
	const override = config?.acp_agent_names?.[provider]?.trim();
	if (override) return override;
	return DEFAULT_ACP_AGENT_NAMES[provider] ?? provider;
}
