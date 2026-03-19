/**
 * Ink-based REPL — replaces the old ANSI-manual classic REPL.
 *
 * This file is the bridge between the existing bee infrastructure
 * (ChatSession, config, commands) and the Ink React UI.
 */

import { render } from "ink";
import chalk from "chalk";
import stringWidth from "string-width";
import type { WorkspaceConfig } from "../types/config.ts";
import { TaskLoader } from "../tasks/loader.ts";
import { StateStore } from "../state/store.ts";
import { SessionStore } from "../state/session.ts";
import { AgentLoop } from "../agent/loop.ts";
import { ProviderRegistry } from "../providers/registry.ts";
import { Verifier } from "../verifier/index.ts";
import { VerificationReporter } from "../verifier/reporter.ts";
import { runPlan } from "./commands/plan.ts";
import { readJsonLines, listFiles, writeJsonFile } from "../utils/fs.ts";
import type { TraceEvent } from "../types/observability.ts";
import { printTaskTable, colorStatus } from "./output.ts";
import { showRtkGain } from "../plugins/rtk.ts";
import { BEE_ICON } from "./bee.ts";
import { ChatSession } from "./chat.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ReplayReader } from "../observability/replay.ts";
import { App } from "./ui/App.tsx";

// ─── Banner ───────────────────────────────────────────────────────────────────

const BOX_W = 43;

function boxLine(content: string, visibleLen: number): string {
  const pad = " ".repeat(Math.max(0, BOX_W - visibleLen));
  return chalk.bold.cyan("║") + content + pad + chalk.bold.cyan("║");
}

function makeBanner(provider: string, useRtk: boolean): string {
  const rtkStr = useRtk ? " ⚡RTK" : "";
  const titleContent = `  ${BEE_ICON}  ${chalk.bold.yellow("BEE")} ${chalk.gray("— Busy Buzzing Agent")}  `;
  const titleVisible = 2 + 5 + 2 + 3 + 1 + 20 + 2;

  const provContent = `  ${chalk.gray(`provider: ${chalk.cyan(provider)}${rtkStr}`)}  `;
  const provVisible = 2 + 10 + provider.length + rtkStr.length + 2;

  const helpContent = `  ${chalk.gray("type /help for commands, /exit to quit")}  `;
  const helpVisible = 2 + 38 + 2;

  const border = "═".repeat(BOX_W);
  return [
    "",
    chalk.bold.cyan(`╔${border}╗`),
    boxLine(titleContent, titleVisible),
    boxLine(provContent, provVisible),
    boxLine(helpContent, helpVisible),
    chalk.bold.cyan(`╚${border}╝`),
    "",
  ].join("\n");
}

// ─── Session summary ──────────────────────────────────────────────────────────

const TOOL_EMOJI_MAP: Record<string, string> = {
  Read: "📖", Write: "✍️", Edit: "✏️", Bash: "🖥️",
  Glob: "🔍", Grep: "🔍", WebFetch: "🌐", WebSearch: "🌐",
  Agent: "🤖", TodoWrite: "📋", NotebookEdit: "📓",
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function getSessionSummaryLines(chat: ChatSession): string[] {
  const s = chat.getSessionStats();
  if (s.messages === 0 && s.totalTools === 0) {
    return ["", chalk.gray("Bye."), ""];
  }

  const W = 58;
  const border = "─".repeat(W);
  const frameLine = (content = "") => {
    const visible = stringWidth(content);
    const pad = " ".repeat(Math.max(0, W - visible));
    return `${chalk.dim("│")}${content}${pad}${chalk.dim("│")}`;
  };
  const separator = chalk.dim(`├${border}┤`);
  const clampToWidth = (text: string, maxWidth: number) => {
    if (stringWidth(text) <= maxWidth) return text;
    let out = "";
    for (const ch of text) {
      const next = out + ch;
      if (stringWidth(`${next}…`) > maxWidth) break;
      out = next;
    }
    return `${out}…`;
  };

  const dur = formatDuration(s.durationMs);
  const msgs = `${s.messages} msg${s.messages !== 1 ? "s" : ""}`;
  const tools = `${s.totalTools} tool${s.totalTools !== 1 ? "s" : ""}`;
  const linesChanged = s.linesChanged > 0 ? `~${s.linesChanged} lines` : "";

  const topToolTokens = [...s.toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => {
      const em = TOOL_EMOJI_MAP[name] ?? "🔧";
      return count > 1 ? `${em}×${count}` : em;
    });
  const topTools = topToolTokens.join("  ");
  const titleText = `  🐝  ${chalk.bold("Session Summary")}`;
  const metrics = [
    `⏱ ${chalk.cyan(dur)}`,
    `💬 ${chalk.cyan(msgs)}`,
    `🔧 ${chalk.cyan(tools)}`,
    ...(linesChanged ? [`✏️ ${chalk.cyan(linesChanged)}`] : []),
  ].join("   ");

  const parts: string[] = [
    "",
    chalk.dim(`╭${border}╮`),
    frameLine(titleText),
    separator,
    frameLine(`  ${clampToWidth(metrics, W - 2)}`),
  ];

  if (topTools) {
    parts.push(frameLine(`  ${clampToWidth(topTools, W - 2)}`));
  }

  const sid = chat.beeSession?.id;
  if (sid) {
    const resumeHint = `  ${chalk.gray("Resume:")} bee --resume ${chalk.cyan(sid.slice(0, 8))}`;
    parts.push(separator);
    parts.push(frameLine(clampToWidth(resumeHint, W)));
  }

  parts.push(chalk.dim(`╰${border}╯`), "");
  return parts;
}

// ─── Status dashboard ─────────────────────────────────────────────────────────

async function getStatusLines(dirs: { tasks: string; state: string }): Promise<string[]> {
  const loader = new TaskLoader(dirs.tasks);
  const tasks = await loader.loadAll();
  if (tasks.length === 0) {
    return [chalk.gray('  No tasks yet — run /plan <spec-file> to create one.'), ""];
  }
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([s, n]) => `${colorStatus(s)}: ${n}`);
  return [`  ${parts.join("   ")}`, ""];
}

async function showStatus(dirs: { tasks: string; state: string }): Promise<void> {
  const loader = new TaskLoader(dirs.tasks);
  const store = new StateStore(dirs.state);
  const tasks = await loader.loadAll();

  if (tasks.length === 0) {
    console.log(chalk.gray('  No tasks yet — run /plan <spec-file> to create one.\n'));
    return;
  }

  const counts: Record<string, number> = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([s, n]) => `${colorStatus(s)}: ${n}`);
  console.log(`  ${parts.join("   ")}\n`);

  const stateMap = new Map<string, NonNullable<Awaited<ReturnType<typeof store.load>>>>();
  for (const task of tasks) {
    const state = await store.load(task.task_id);
    if (state) stateMap.set(task.task_id, state);
  }
  printTaskTable(tasks, stateMap);
  console.log();
}

async function runReplaySafe(
  logsDir: string,
  taskId: string,
  traceId?: string
): Promise<void> {
  let logFile: string;

  if (traceId) {
    logFile = join(logsDir, `${traceId}.jsonl`);
  } else {
    const allLogs = await listFiles(logsDir, ".jsonl");
    const taskLogs = allLogs.filter((f) => !f.endsWith("costs.jsonl"));

    let found: string | undefined;
    for (const logPath of taskLogs.reverse()) {
      try {
        const text = await Bun.file(logPath).text();
        if (text.includes(`"task_id":"${taskId}"`) || text.includes(`"task_id": "${taskId}"`)) {
          found = logPath;
          break;
        }
      } catch {}
    }

    if (!found) {
      console.log(chalk.red(`No log found for task: ${taskId}`));
      return;
    }
    logFile = found;
  }

  if (!existsSync(logFile)) {
    console.log(chalk.red(`Log file not found: ${logFile}`));
    return;
  }

  console.log(chalk.gray(`Replaying: ${logFile}\n`));
  const reader = new ReplayReader(logFile);
  await reader.replay({});
}

function getProviderPickerOptions(config: WorkspaceConfig): { options: string[]; active: string } {
  const registry = new ProviderRegistry(config);
  return { options: registry.list(), active: config.provider };
}

async function switchProvider(
  config: WorkspaceConfig,
  dirs: { state: string; logs: string; config?: string },
  target: string,
  chat?: ChatSession
): Promise<void> {
  const registry = new ProviderRegistry(config);
  const available = registry.list();

  if (!available.includes(target)) {
    console.log(chalk.red(`  Unknown provider: ${target}`));
    console.log(chalk.gray(`  Available: ${available.join(", ")}\n`));
    return;
  }

  const health = await registry.get(target).health();
  if (!health) {
    console.log(chalk.yellow(`  ⚠ "${target}" health check failed — switching anyway.`));
  }

  const sessionStore = new SessionStore(dirs.state);
  await sessionStore.init(config.provider);
  await sessionStore.switchProvider(target, "manual switch");

  if (chat) {
    await chat.switchProvider(target);
  } else {
    config.provider = target;
  }

  const configPath = dirs.config ?? join(dirs.logs, "..", ".bee", "config.json");
  await writeJsonFile(configPath, config);

  console.log(chalk.green(`\n  ✓ Switched to ${chalk.bold(target)}\n`));
}

// ─── Command handler ──────────────────────────────────────────────────────────

async function handleCommand(
  cmd: string,
  args: string[],
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string; config: string },
  chat: ChatSession
): Promise<boolean> {
  switch (cmd) {
    case "help":
      console.log(chalk.bold("\nAvailable commands:\n"));
      const groups = [
        { label: "Tasks",    cmds: ["status", "tasks", "run", "plan", "verify", "resume", "replay"] },
        { label: "Provider", cmds: ["provider", "switch", "session"] },
        { label: "Info",     cmds: ["config", "logs", "gain"] },
        { label: "Shell",    cmds: ["chat", "clear", "exit"] },
      ];
      const { SLASH_COMMANDS: cmds } = await import("./commands.ts");
      for (const group of groups) {
        console.log(chalk.bold.gray(`  ${group.label}`));
        for (const name of group.cmds) {
          const c = cmds.find((c: { name: string }) => c.name === name);
          if (!c) continue;
          const nameStr = chalk.cyan(`/${c.name}`).padEnd(20);
          const alias = c.alias ? chalk.gray(` /${c.alias}`) : "   ";
          console.log(`    ${nameStr}${alias}  ${chalk.gray(c.desc)}`);
        }
        console.log();
      }
      break;

    case "chat": {
      const sub = args[0];
      if (sub === "clear") {
        chat.clearHistory();
        console.log(chalk.gray("  Chat history cleared.\n"));
      } else {
        console.log(chalk.gray("  Usage: /chat clear\n"));
      }
      break;
    }

    case "status":
      await showStatus(dirs);
      break;

    case "run": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const dryRun = args.includes("--dry-run");
      const loop = new AgentLoop(config, dirs);

      // Ink mode: no raw stdin prompt; auto-choose fallback provider.
      const onLimitHit = async (provider: string, message: string) => {
        const registry = new ProviderRegistry(config);
        const available = registry.list().filter((p) => p !== provider);
        if (available.length === 0) {
          console.log(chalk.red("\n  No other providers available. Aborting.\n"));
          return null;
        }
        const fallback = available[0]!;
        console.log(chalk.yellow(`\n  Provider "${provider}" hit a limit: ${message}`));
        console.log(chalk.gray(`  Ink mode auto-switch: ${chalk.cyan(fallback)}\n`));
        config.provider = fallback;
        const configPath = join(dirs.logs, "..", ".bee", "config.json");
        await writeJsonFile(configPath, config);
        return fallback;
      };

      await loop.run({ taskId, dryRun, verbose: true, onLimitHit });
      if (config.use_rtk) await showRtkGain();
      break;
    }

    case "tasks": {
      const loader = new TaskLoader(dirs.tasks);
      const store = new StateStore(dirs.state);
      const tasks = await loader.loadAll();
      const filter = args.find((_a, i) => args[i - 1] === "--status");
      const filtered = filter ? tasks.filter((t) => t.status === filter) : tasks;
      if (filtered.length === 0) {
        console.log(chalk.gray("  No tasks found.\n"));
        break;
      }
      const stateMap = new Map<string, NonNullable<Awaited<ReturnType<typeof store.load>>>>();
      for (const task of filtered) {
        const state = await store.load(task.task_id);
        if (state) stateMap.set(task.task_id, state);
      }
      printTaskTable(filtered, stateMap);
      console.log();
      break;
    }

    case "plan": {
      const specFile = args.find((a) => !a.startsWith("--"));
      if (!specFile) {
        console.log(chalk.red("  Usage: /plan <spec-file>"));
        break;
      }
      if (!existsSync(specFile)) {
        console.log(chalk.red(`  Spec file not found: ${specFile}`));
        break;
      }
      const providerArg = args.find((_a, i) => args[i - 1] === "--provider");
      await runPlan(specFile, dirs.tasks, {
        provider: providerArg ?? config.provider,
      });
      break;
    }

    case "verify": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const loader = new TaskLoader(dirs.tasks);
      const verifier = new Verifier();
      const reporter = new VerificationReporter();
      const allTasks = await loader.loadAll();
      const targets = taskId
        ? allTasks.filter((t) => t.task_id === taskId)
        : allTasks;
      for (const task of targets) {
        console.log(chalk.bold(`  Verifying: ${task.task_id}`));
        const summary = await verifier.runAll(task);
        reporter.print(summary);
      }
      break;
    }

    case "resume": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const loader = new TaskLoader(dirs.tasks);
      const allTasks = await loader.loadAll();
      const resumable = taskId
        ? allTasks.filter((t) => t.task_id === taskId)
        : allTasks.filter((t) => !["done", "failed"].includes(t.status));

      if (resumable.length === 0) {
        console.log(chalk.yellow("  No resumable tasks found.\n"));
        break;
      }
      const loop = new AgentLoop(config, dirs);
      for (const task of resumable) {
        await loop.run({ taskId: task.task_id, verbose: true });
      }
      break;
    }

    case "replay": {
      const taskId = args.find((a) => !a.startsWith("--"));
      if (!taskId) {
        console.log(chalk.red("  Usage: /replay <task-id>"));
        break;
      }
      const traceId = args.find((_a, i) => args[i - 1] === "--trace-id");
      await runReplaySafe(dirs.logs, taskId, traceId);
      break;
    }

    case "provider": {
      const registry = new ProviderRegistry(config);
      const available = registry.list();
      const target = args[0];

      if (target) {
        await switchProvider(config, { state: dirs.state, logs: dirs.logs, config: dirs.config }, target, chat);
        break;
      }

      console.log(`\n  Model   : ${chalk.cyan(config.model ?? "(default)")}`);
      console.log(`  RTK     : ${config.use_rtk ? chalk.green("enabled") : chalk.gray("disabled")}`);
      console.log(`  Retries : ${config.max_retries}  Timeout : ${config.timeout_ms / 1000}s\n`);
      console.log(chalk.bold("  Available providers:"));
      for (const p of available) {
        const active = p === config.provider ? chalk.green(" ← active") : "";
        console.log(`    ${chalk.cyan(p)}${active}`);
      }
      console.log(chalk.gray('\n  Ink mode: use "/provider <name>" to switch.\n'));
      break;
    }

    case "switch": {
      const target = args[0];
      const registry = new ProviderRegistry(config);
      const available = registry.list();

      if (!target) {
        console.log(chalk.bold("\n  Available providers:"));
        available.forEach((p, i) => {
          const active = p === config.provider ? chalk.green(" ← active") : "";
          console.log(`    ${chalk.cyan(`[${i + 1}]`)} ${p}${active}`);
        });
        console.log(chalk.gray('\n  Usage: /switch <provider-name>\n'));
        break;
      }

      if (!available.includes(target)) {
        console.log(chalk.red(`  Unknown provider: ${target}. Available: ${available.join(", ")}\n`));
        break;
      }

      await switchProvider(config, { state: dirs.state, logs: dirs.logs, config: dirs.config }, target, chat);
      break;
    }

    case "session": {
      const sessionStore = new SessionStore(dirs.state);
      const session = await sessionStore.load();
      if (!session) {
        console.log(chalk.gray("  No active session.\n"));
        break;
      }
      console.log(chalk.bold(`\n  Session ${chalk.gray(session.session_id)}`));
      console.log(`  Started   : ${chalk.cyan(new Date(session.started_at).toLocaleString())}`);
      console.log(`  Provider  : ${chalk.cyan(session.active_provider)}\n`);

      console.log(chalk.bold("  Provider usage:"));
      for (const [name, ps] of Object.entries(session.providers)) {
        const active = name === session.active_provider ? chalk.green(" ← active") : "";
        console.log(
          `    ${chalk.cyan(name.padEnd(14))}${active}  ${ps.tokens_used.toLocaleString()} tokens  $${ps.cost_usd.toFixed(4)}`
        );
      }

      if (session.limit_events.length > 0) {
        console.log(chalk.bold("\n  Limit events:"));
        for (const ev of session.limit_events.slice(-5)) {
          const switched = ev.switched_to ? chalk.yellow(` → ${ev.switched_to}`) : "";
          console.log(
            `    ${chalk.red(ev.kind.padEnd(16))} ${chalk.gray(ev.provider)}${switched}  ${chalk.gray(new Date(ev.timestamp).toLocaleTimeString())}`
          );
          console.log(chalk.gray(`      ${ev.message.slice(0, 80)}`));
        }
      }

      if (session.shared_context) {
        console.log(chalk.bold("\n  Shared context:"));
        console.log(chalk.gray(`    ${session.shared_context.slice(0, 200)}`));
      }
      console.log();
      break;
    }

    case "config": {
      const configPath = join(dirs.logs, "..", ".bee", "config.json");
      try {
        const raw = await Bun.file(configPath).text();
        console.log("\n" + chalk.gray(raw) + "\n");
      } catch {
        console.log(chalk.gray("  Config not found.\n"));
      }
      break;
    }

    case "logs": {
      const taskId = args.find((a) => !a.startsWith("--"));
      const tailArg = args.find((_a, i) => args[i - 1] === "--tail");
      const tail = tailArg ? parseInt(tailArg, 10) : 20;

      const allLogs = await listFiles(dirs.logs, ".jsonl");
      const logFiles = allLogs.filter((f) => !f.endsWith("costs.jsonl")).reverse();

      let events: TraceEvent[] = [];
      for (const logFile of logFiles.slice(0, 5)) {
        const fileEvents = await readJsonLines<TraceEvent>(logFile);
        const filtered = taskId
          ? fileEvents.filter((e) => e.task_id === taskId)
          : fileEvents;
        events = [...events, ...filtered];
        if (events.length >= tail) break;
      }

      const recent = events.slice(-tail);
      if (recent.length === 0) {
        console.log(chalk.gray("  No logs found.\n"));
        break;
      }
      console.log(chalk.bold(`\n  Last ${recent.length} events:\n`));
      for (const event of recent) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        console.log(
          `  ${chalk.gray(time)}  ${chalk.cyan(event.kind.padEnd(24))} ${chalk.gray(event.task_id)}`
        );
      }
      console.log();
      break;
    }

    case "gain":
      await showRtkGain();
      break;

    case "clear":
      // Ink App handles clear by resetting content lines.
      break;

    case "exit":
      return true;

    default:
      console.log(chalk.red(`  Unknown command: /${cmd}`));
      console.log(chalk.gray('  Type /help to see available commands.\n'));
  }
  return false;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runRepl(
  config: WorkspaceConfig,
  dirs: { tasks: string; state: string; logs: string; config: string },
  opts: { resumeSessionId?: string; resumeLatest?: boolean } = {}
): Promise<void> {
  const chatSession = new ChatSession(config, {
    onStatusUpdate: () => {},  // Ink component handles status display
    projectPath: process.cwd(),
  });
  await chatSession.initSession({
    resumeSessionId: opts.resumeSessionId,
    resumeLatest: opts.resumeLatest,
  });

  const banner = makeBanner(config.provider, config.use_rtk ?? false);
  const initialStatus = await getStatusLines(dirs);
  const initialTranscript = chatSession.transcript.map((line) => ({
    type: line.type,
    text: line.text,
  }));

  const { waitUntilExit } = render(
    <App
      config={config}
      chatSession={chatSession}
      banner={banner}
      initialStatus={initialStatus}
      initialTranscript={initialTranscript}
      onCommand={(cmd, args) => handleCommand(cmd, args, config, dirs, chatSession)}
      onProviderPickerRequest={async () => getProviderPickerOptions(config)}
      onProviderSelected={async (provider) => {
        await switchProvider(
          config,
          { state: dirs.state, logs: dirs.logs, config: dirs.config },
          provider,
          chatSession
        );
      }}
      onExit={() => getSessionSummaryLines(chatSession)}
    />,
    { exitOnCtrlC: false }
  );

  await waitUntilExit();
}
