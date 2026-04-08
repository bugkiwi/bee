import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	consumeLatestCrashNotice,
	createCrashLogger,
	formatLatestCrashNoticeLines,
	type CrashLogPayload,
} from "../observability/crash-logger.ts";
import { readJsonFile } from "../utils/fs.ts";

describe("createCrashLogger", () => {
	it("writes a crash file with error, stack, breadcrumb, and context", async () => {
		const root = mkdtempSync(join(tmpdir(), "bee-crash-logger-"));
		const logsDir = join(root, ".bee", "logs");
		const logger = createCrashLogger(logsDir);

		logger.updateContext({
			activeProvider: "kimi",
			queueDepth: 2,
		});
		logger.addBreadcrumb("mouse.scroll", { direction: "up", y: 22 });

		const filePath = await logger.capture(new Error("boom"), {
			scope: "repl-ui",
			activePlanId: "skeleton_deadbeef1234",
		});
		const payload = await readJsonFile<CrashLogPayload>(filePath);

		expect(payload.error.message).toBe("boom");
		expect(payload.error.stack).toContain("Error: boom");
		expect(payload.context.scope).toBe("repl-ui");
		expect(payload.context.activeProvider).toBe("kimi");
		expect(payload.context.queueDepth).toBe(2);
		expect(payload.context.activePlanId).toBe("skeleton_deadbeef1234");
		expect(payload.breadcrumbs.at(-1)?.kind).toBe("mouse.scroll");
		expect(payload.breadcrumbs.at(-1)?.data).toEqual({
			direction: "up",
			y: 22,
		});

		const notice = await consumeLatestCrashNotice(logsDir);
		expect(notice?.path).toBe(filePath);
		expect(notice?.error.message).toBe("boom");
		expect(notice?.context.scope).toBe("repl-ui");
		expect(await consumeLatestCrashNotice(logsDir)).toBeNull();
	});

	it("builds a payload without writing so callers can inspect merged context", () => {
		const root = mkdtempSync(join(tmpdir(), "bee-crash-logger-"));
		const logger = createCrashLogger(join(root, ".bee", "logs"));

		logger.updateContext({
			queueItems: ["first follow-up"],
		});

		const payload = logger.buildPayload(new Error("repl died"), {
			scope: "ink.waitUntilExit",
			queueDepth: 1,
			activePlanId: "skeleton_deadbeef1234",
		});

		expect(payload.context.queueItems).toEqual(["first follow-up"]);
		expect(payload.context.queueDepth).toBe(1);
		expect(payload.context.activePlanId).toBe("skeleton_deadbeef1234");
	});

	it("formats the latest crash notice into startup lines", () => {
		const lines = formatLatestCrashNoticeLines(
			{
				ts: "2026-04-08T02:20:12.624Z",
				path: "/tmp/bee/.bee/logs/crash-2026-04-08T02-20-12.623Z-abc.json",
				error: {
					name: "RuntimeError",
					message: "Out of bounds call_indirect",
				},
				context: {
					scope: "process.uncaughtException",
				},
			},
			"/tmp/bee",
		);

		expect(lines).toContain(
			"  Previous crash detected · process.uncaughtException",
		);
		expect(lines).toContain("  RuntimeError: Out of bounds call_indirect");
		expect(lines).toContain(
			"  log: .bee/logs/crash-2026-04-08T02-20-12.623Z-abc.json",
		);
	});
});
