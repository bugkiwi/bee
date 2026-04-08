import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileExists, readJsonFile, writeJsonFile } from "../utils/fs.ts";

const MAX_BREADCRUMBS = 40;
const LATEST_CRASH_NOTICE_FILE = "latest-crash.json";

export interface CrashBreadcrumb {
	ts: string;
	kind: string;
	data?: Record<string, unknown>;
}

export interface CrashLogPayload {
	ts: string;
	error: {
		name: string;
		message: string;
		stack?: string;
	};
	context: Record<string, unknown>;
	breadcrumbs: CrashBreadcrumb[];
}

export interface LatestCrashNotice {
	ts: string;
	path: string;
	error: {
		name: string;
		message: string;
	};
	context: Record<string, unknown>;
}

export interface CrashLogger {
	addBreadcrumb: (kind: string, data?: Record<string, unknown>) => void;
	updateContext: (partial: Record<string, unknown>) => void;
	buildPayload: (
		error: unknown,
		context?: Record<string, unknown>,
	) => CrashLogPayload;
	capture: (
		error: unknown,
		context?: Record<string, unknown>,
	) => Promise<string>;
	captureSync: (error: unknown, context?: Record<string, unknown>) => string;
}

export interface InstallProcessCrashHandlersOptions {
	baseContext?: Record<string, unknown>;
	beforeReport?: () => void;
}

function normalizeError(error: unknown): CrashLogPayload["error"] {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}

	return {
		name: "Error",
		message: String(error),
	};
}

function buildCrashLogPath(logDir: string): string {
	return join(
		logDir,
		`crash-${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}.json`,
	);
}

function getLatestCrashNoticePath(logDir: string): string {
	return join(logDir, LATEST_CRASH_NOTICE_FILE);
}

function buildLatestCrashNotice(
	path: string,
	payload: CrashLogPayload,
): LatestCrashNotice {
	return {
		ts: payload.ts,
		path,
		error: {
			name: payload.error.name,
			message: payload.error.message,
		},
		context: payload.context,
	};
}

async function writeLatestCrashNotice(
	logDir: string,
	path: string,
	payload: CrashLogPayload,
): Promise<void> {
	await writeJsonFile(
		getLatestCrashNoticePath(logDir),
		buildLatestCrashNotice(path, payload),
	);
}

function writeLatestCrashNoticeSync(
	logDir: string,
	path: string,
	payload: CrashLogPayload,
): void {
	const noticePath = getLatestCrashNoticePath(logDir);
	mkdirSync(dirname(noticePath), { recursive: true });
	writeFileSync(
		noticePath,
		`${JSON.stringify(buildLatestCrashNotice(path, payload), null, 2)}\n`,
		"utf8",
	);
}

export async function consumeLatestCrashNotice(
	logDir: string,
): Promise<LatestCrashNotice | null> {
	const noticePath = getLatestCrashNoticePath(logDir);
	if (!fileExists(noticePath)) return null;
	const notice = await readJsonFile<LatestCrashNotice>(noticePath);
	const { rm } = await import("node:fs/promises");
	await rm(noticePath, { force: true });
	return notice;
}

export function formatLatestCrashNoticeLines(
	notice: LatestCrashNotice | null,
	cwd = process.cwd(),
): string[] {
	if (!notice) return [];
	const scope =
		typeof notice.context.scope === "string"
			? ` · ${notice.context.scope}`
			: "";
	const relativePath = relative(cwd, notice.path);
	const displayPath =
		relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/")
			? relativePath
			: notice.path;
	return [
		"",
		`  Previous crash detected${scope}`,
		`  ${notice.error.name}: ${notice.error.message}`,
		`  log: ${displayPath}`,
		"",
	];
}

export function createCrashLogger(logDir: string): CrashLogger {
	const breadcrumbs: CrashBreadcrumb[] = [];
	const baseContext: Record<string, unknown> = {};

	return {
		addBreadcrumb(kind, data) {
			breadcrumbs.push({
				ts: new Date().toISOString(),
				kind,
				...(data ? { data } : {}),
			});
			if (breadcrumbs.length > MAX_BREADCRUMBS) {
				breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
			}
		},
		updateContext(partial) {
			Object.assign(baseContext, partial);
		},
		buildPayload(error, context = {}) {
			return {
				ts: new Date().toISOString(),
				error: normalizeError(error),
				context: {
					...baseContext,
					...context,
				},
				breadcrumbs: [...breadcrumbs],
			};
		},
			async capture(error, context = {}) {
				const path = buildCrashLogPath(logDir);
				const payload = this.buildPayload(error, context);
				await writeJsonFile(path, payload);
				await writeLatestCrashNotice(logDir, path, payload);
				return path;
			},
			captureSync(error, context = {}) {
				const path = buildCrashLogPath(logDir);
				const payload = this.buildPayload(error, context);
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
				writeLatestCrashNoticeSync(logDir, path, payload);
				return path;
			},
		};
}

let handlersInstalled = false;

export function installProcessCrashHandlers(
	logger: CrashLogger,
	options: InstallProcessCrashHandlersOptions = {},
): void {
	if (handlersInstalled) return;
	handlersInstalled = true;
	const { baseContext = {}, beforeReport } = options;

	process.on("uncaughtException", (error) => {
		beforeReport?.();
		const path = logger.captureSync(error, {
			...baseContext,
			scope: "process.uncaughtException",
		});
		process.stderr.write(`Bee crash log: ${path}\n`);
		process.exit(1);
	});

	process.on("unhandledRejection", (reason) => {
		beforeReport?.();
		const path = logger.captureSync(reason, {
			...baseContext,
			scope: "process.unhandledRejection",
		});
		process.stderr.write(`Bee crash log: ${path}\n`);
		process.exit(1);
	});
}
