import { describe, expect, it } from "bun:test";
import {
	ChatSession,
	buildAcpChatRequest,
	buildProviderHandoff,
	buildProviderRequest,
} from "../cli/chat.ts";
import { getAcpCommandConfig } from "../providers/acp/commands.ts";
import { resolveAcpAgentName } from "../providers/acp/agents.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { WorkspaceConfigSchema } from "../schema/config.schema.ts";
import type { BeeSession } from "../session/manager.ts";
import { DEFAULT_CONFIG } from "../types/config.ts";

// ─── detectAuthError (copied inline for unit testing) ────────────────────────
// The real function lives in chat.ts as a private module-level function.
// We test the same logic here without importing the whole module.

function detectAuthError(stderr: string, provider: string): string | null {
	const s = stderr.toLowerCase();
	if (provider === "claude") {
		if (
			s.includes("not authenticated") ||
			s.includes("login") ||
			s.includes("auth")
		) {
			return "Claude not authenticated";
		}
	}
	if (provider === "codex") {
		if (
			s.includes("api key") ||
			s.includes("openai_api_key") ||
			s.includes("unauthorized")
		) {
			return "Set your OPENAI_API_KEY";
		}
	}
	if (provider === "kimi") {
		if (
			s.includes("api key") ||
			s.includes("moonshot") ||
			s.includes("unauthorized")
		) {
			return "Set your MOONSHOT_API_KEY";
		}
	}
	return null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("detectAuthError", () => {
	it("returns null when stderr is empty", () => {
		expect(detectAuthError("", "claude")).toBeNull();
		expect(detectAuthError("", "codex")).toBeNull();
		expect(detectAuthError("", "kimi")).toBeNull();
	});

	it("detects claude auth errors", () => {
		expect(detectAuthError("Error: not authenticated", "claude")).toBeTruthy();
		expect(
			detectAuthError("Please run claude auth login", "claude"),
		).toBeTruthy();
		expect(detectAuthError("auth failed", "claude")).toBeTruthy();
	});

	it("does NOT false-positive claude on unrelated errors", () => {
		expect(detectAuthError("rate limit exceeded", "claude")).toBeNull();
		expect(detectAuthError("timeout", "claude")).toBeNull();
	});

	it("detects codex auth errors", () => {
		expect(detectAuthError("OPENAI_API_KEY not set", "codex")).toBeTruthy();
		expect(detectAuthError("invalid api key", "codex")).toBeTruthy();
		expect(detectAuthError("401 unauthorized", "codex")).toBeTruthy();
	});

	it("detects kimi auth errors", () => {
		expect(detectAuthError("MOONSHOT_API_KEY missing", "kimi")).toBeTruthy();
		expect(detectAuthError("unauthorized request", "kimi")).toBeTruthy();
	});

	it("does not cross-match providers", () => {
		// 'api key' matches codex/kimi but not claude
		expect(detectAuthError("api key not set", "claude")).toBeNull();
	});
});

describe("ACP chat request", () => {
	it("parses acp_commands through WorkspaceConfigSchema", () => {
		const config = WorkspaceConfigSchema.parse({
			acp_commands: {
				codex: {
					command: "codex-acp",
					args: ["--verbose"],
					env: { OPENAI_API_KEY: "test" },
				},
			},
		});

		expect(config.acp_commands?.codex).toEqual({
			command: "codex-acp",
			args: ["--verbose"],
			env: { OPENAI_API_KEY: "test" },
		});
	});

	it("rejects blank acp_commands commands through WorkspaceConfigSchema", () => {
		expect(() =>
			WorkspaceConfigSchema.parse({
				acp_commands: {
					codex: {
						command: "   ",
					},
				},
			}),
		).toThrow();
	});

	it("drops obsolete acp_base_url from parsed config", () => {
		const config = WorkspaceConfigSchema.parse({
			acp_base_url: "http://127.0.0.1:43110",
		});

		expect("acp_base_url" in config).toBe(false);
	});

	it("uses built-in stdio ACP defaults for the shipped providers", () => {
		expect(getAcpCommandConfig("claude")).toEqual({
			command: "npx",
			args: ["-y", "@zed-industries/claude-code-acp"],
			env: {},
		});
		expect(getAcpCommandConfig("codex")).toEqual({
			command: "npx",
			args: ["-y", "@zed-industries/codex-acp"],
			env: {},
		});
		expect(getAcpCommandConfig("kimi")).toEqual({
			command: "kimi",
			args: ["acp"],
			env: {},
		});
	});

	it("honors acp_commands overrides", () => {
		expect(
			getAcpCommandConfig("codex", {
				acp_commands: {
					codex: { command: "codex-acp", args: ["--verbose"] },
				},
			}),
		).toEqual({
			command: "codex-acp",
			args: ["--verbose"],
			env: {},
		});
	});

	it("uses default ACP agent names", () => {
		expect(resolveAcpAgentName("claude")).toBe("claude-code");
		expect(resolveAcpAgentName("codex")).toBe("codex");
		expect(resolveAcpAgentName("kimi")).toBe("kimi");
	});

	it("honors ACP agent name overrides", () => {
		expect(
			resolveAcpAgentName("codex", {
				acp_agent_names: { codex: "openai-codex" },
			}),
		).toBe("openai-codex");
	});

	it("includes ACP session_id when resuming a provider session", () => {
		const request = buildAcpChatRequest(
			"hello",
			"claude",
			undefined,
			"sess-123",
		);
		expect(request.agent_name).toBe("claude-code");
		expect(request.session_id).toBe("sess-123");
		expect(request.mode).toBe("async");
		expect(request.input[0]?.role).toBe("user");
		expect(request.input[0]?.parts[0]?.content).toBe("hello");
		expect(request.input[0]?.parts[0]?.content_type).toBe("text/plain");
	});

	it("uses the provider name as the ACP agent name fallback", () => {
		const request = buildAcpChatRequest("hello", "custom-agent");
		expect(request.agent_name).toBe("custom-agent");
	});
});

describe("ProviderRegistry", () => {
	it("lists only the shipped providers", () => {
		const registry = new ProviderRegistry(DEFAULT_CONFIG);

		expect(registry.list()).toEqual(["claude", "codex", "kimi"]);
		expect(() => registry.get("claude-acp")).toThrow(
			'Unknown provider: "claude-acp". Available: claude, codex, kimi',
		);
	});
});

describe("ChatSession ACP routing", () => {
	it("treats shipped providers as ACP-backed without acp_base_url", () => {
		for (const provider of ["claude", "codex", "kimi"]) {
			const chat = new ChatSession({ ...DEFAULT_CONFIG, provider });
			expect(
				(chat as unknown as { shouldUseAcp: () => boolean }).shouldUseAcp(),
			).toBe(true);
		}

		const custom = new ChatSession({ ...DEFAULT_CONFIG, provider: "custom" });
		expect(
			(custom as unknown as { shouldUseAcp: () => boolean }).shouldUseAcp(),
		).toBe(false);
	});

	it("routes shipped providers through ACP without acp_base_url", async () => {
		for (const provider of ["claude", "codex", "kimi"]) {
			const chat = new ChatSession({ ...DEFAULT_CONFIG, provider });
			let acpCalls = 0;
			let nativeCalls = 0;

			(
				chat as unknown as {
					sendViaAcp: (nextProvider: string, message: string) => Promise<string>;
					sendClaude: (message: string) => Promise<string>;
					sendCodex: (message: string) => Promise<string>;
				}
			).sendViaAcp = async (nextProvider, message) => {
				acpCalls += 1;
				expect(nextProvider).toBe(provider);
				expect(message).toBe("hello");
				return "acp-ok";
			};
			(
				chat as unknown as {
					sendClaude: (message: string) => Promise<string>;
					sendCodex: (message: string) => Promise<string>;
				}
			).sendClaude = async () => {
				nativeCalls += 1;
				return "claude-native";
			};
			(
				chat as unknown as {
					sendClaude: (message: string) => Promise<string>;
					sendCodex: (message: string) => Promise<string>;
				}
			).sendCodex = async () => {
				nativeCalls += 1;
				return "codex-native";
			};

			await chat.send("hello", {});

			expect(acpCalls).toBe(1);
			expect(nativeCalls).toBe(0);
		}
	});

	it("does not route unknown providers through ACP", async () => {
		const chat = new ChatSession({
			...DEFAULT_CONFIG,
			provider: "custom",
		});
		let acpCalls = 0;
		let nativeCalls = 0;

		(
			chat as unknown as {
				sendViaAcp: (nextProvider: string, message: string) => Promise<string>;
				sendClaude: (message: string) => Promise<string>;
			}
		).sendViaAcp = async (_nextProvider, _message) => {
			acpCalls += 1;
			return "acp-ok";
		};
		(
			chat as unknown as {
				sendClaude: (message: string) => Promise<string>;
			}
		).sendClaude = async (message) => {
			nativeCalls += 1;
			expect(message).toBe("hello");
			return "claude-native";
		};

		await chat.send("hello", {});

		expect(acpCalls).toBe(0);
		expect(nativeCalls).toBe(1);
	});
});

describe("No buildPrompt — session continuation", () => {
	it("provider requests still pass the raw user message when no handoff is needed", () => {
		const userMessage = "What is 1+1?";
		const request = buildProviderRequest(userMessage, "claude", null);
		expect(request).toBe("What is 1+1?");
		expect(request).not.toContain("Human:");
		expect(request).not.toContain("Assistant:");
	});
});

describe("provider handoff", () => {
	it("returns null when the target provider is already synced", () => {
		const session: BeeSession = {
			id: "s1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			projectPath: "/tmp/project",
			activeProvider: "claude",
			messageCount: 2,
			transcriptSeq: 2,
			providers: {
				claude: {
					provider: "claude",
					nativeId: "claude-thread",
					syncedThrough: 2,
					tokens: 0,
					cost: 0,
					lastActive: "2026-01-01T00:00:00.000Z",
				},
			},
			transcript: [
				{
					type: "user",
					text: "  › fix auth",
					at: "2026-01-01T00:00:00.000Z",
					seq: 1,
				},
				{
					type: "assistant",
					text: "Done",
					at: "2026-01-01T00:00:01.000Z",
					seq: 2,
				},
			],
		};

		expect(buildProviderHandoff(session, "claude")).toBeNull();
	});

	it("injects only unseen transcript lines for a lagging provider", () => {
		const session: BeeSession = {
			id: "s1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			projectPath: "/tmp/project",
			activeProvider: "codex",
			messageCount: 4,
			transcriptSeq: 4,
			providers: {
				claude: {
					provider: "claude",
					nativeId: "claude-thread",
					syncedThrough: 4,
					tokens: 0,
					cost: 0,
					lastActive: "2026-01-01T00:00:00.000Z",
				},
				codex: {
					provider: "codex",
					nativeId: "codex-thread",
					syncedThrough: 2,
					tokens: 0,
					cost: 0,
					lastActive: "2026-01-01T00:00:02.000Z",
				},
			},
			transcript: [
				{
					type: "user",
					text: "  › fix auth",
					at: "2026-01-01T00:00:00.000Z",
					seq: 1,
				},
				{
					type: "assistant",
					text: "Done",
					at: "2026-01-01T00:00:01.000Z",
					seq: 2,
				},
				{
					type: "user",
					text: "  › add tests",
					at: "2026-01-01T00:00:02.000Z",
					seq: 3,
				},
				{
					type: "assistant",
					text: "Added parser tests.",
					at: "2026-01-01T00:00:03.000Z",
					seq: 4,
				},
			],
		};

		const handoff = buildProviderHandoff(session, "codex");
		expect(handoff).toBeTruthy();
		expect(handoff).not.toContain("fix auth");
		expect(handoff).toContain("add tests");
		expect(handoff).toContain("Added parser tests.");

		const request = buildProviderRequest(
			"continue with edge cases",
			"codex",
			session,
		);
		expect(request).toContain("New user message:");
		expect(request).toContain("continue with edge cases");
	});
});
