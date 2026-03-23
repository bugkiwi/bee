import { z } from "zod";

export const WorkspaceConfigSchema = z.object({
	provider: z.string().default("claude"),
	model: z.string().optional(),
	max_retries: z.number().int().positive().default(3),
	timeout_ms: z.number().positive().default(300_000),
	backoff_ms: z.number().positive().default(5_000),
	backoff_multiplier: z.number().positive().default(2.0),
	price_table: z
		.record(
			z.object({
				input_per_1m: z.number().nonnegative(),
				output_per_1m: z.number().nonnegative(),
			}),
		)
		.optional(),
	acp_base_url: z.string().url().optional(),
	acp_agent_names: z.record(z.string()).optional(),
	_initialized: z.boolean().optional(),
	use_rtk: z.boolean().optional(),
	use_plugins: z.boolean().optional(),
	edit_mode: z.boolean().default(true),
	kimi_api_key: z.string().optional(),
	kimi_model: z.string().optional(),
	kimi_base_url: z.string().url().optional(),
});
