import type { WorkspaceConfig } from "../../types/config.ts";

export interface AcpCommandConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

const DEFAULT_ACP_COMMANDS: Record<string, AcpCommandConfig> = {
	claude: {
		command: "npx",
		args: ["-y", "@zed-industries/claude-code-acp"],
		env: {},
	},
	codex: {
		command: "npx",
		args: ["-y", "@zed-industries/codex-acp"],
		env: {},
	},
	kimi: {
		command: "kimi",
		args: ["acp"],
		env: {},
	},
};

export function getAcpCommandConfig(
	provider: string,
	config?: Pick<WorkspaceConfig, "acp_commands">,
): AcpCommandConfig {
	const override = config?.acp_commands?.[provider];
	if (override) {
		const command = override.command.trim();
		if (!command) {
			throw new Error(
				`No local ACP command configured for provider "${provider}"`,
			);
		}
		return {
			command,
			args: override.args ?? [],
			env: override.env ?? {},
		};
	}

	const builtIn = DEFAULT_ACP_COMMANDS[provider];
	if (!builtIn) {
		throw new Error(`No local ACP command configured for provider "${provider}"`);
	}
	return builtIn;
}
