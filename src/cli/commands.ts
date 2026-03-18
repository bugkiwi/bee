export interface SlashCommand {
  name: string;
  alias?: string;
  desc: string;
  usage: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    alias: "h",
    desc: "Show all available commands",
    usage: "/help",
  },
  {
    name: "status",
    alias: "s",
    desc: "Task status dashboard",
    usage: "/status",
  },
  {
    name: "run",
    alias: "r",
    desc: "Run pending tasks",
    usage: "/run [task-id] [--dry-run]",
  },
  {
    name: "plan",
    alias: "pl",
    desc: "Generate a task from a spec file",
    usage: "/plan <spec-file> [--provider claude|codex|kimi]",
  },
  {
    name: "verify",
    alias: "v",
    desc: "Verify task completion (tests + lint + typecheck)",
    usage: "/verify [task-id] [--all]",
  },
  {
    name: "resume",
    desc: "Resume incomplete/failed tasks",
    usage: "/resume [task-id]",
  },
  {
    name: "replay",
    desc: "Replay execution log for a task",
    usage: "/replay <task-id> [--trace-id <id>]",
  },
  {
    name: "tasks",
    alias: "t",
    desc: "List all tasks with status details",
    usage: "/tasks [--status pending|running|done|failed]",
  },
  {
    name: "provider",
    alias: "p",
    desc: "Show providers / switch: /provider <name>",
    usage: "/provider [claude|codex|kimi]",
  },
  {
    name: "gain",
    desc: "Show RTK token savings report",
    usage: "/gain",
  },
  {
    name: "logs",
    alias: "l",
    desc: "Show recent execution logs",
    usage: "/logs [task-id] [--tail N]",
  },
  {
    name: "config",
    alias: "c",
    desc: "Show workspace configuration",
    usage: "/config",
  },
  {
    name: "switch",
    desc: "Switch provider (preserves session context)",
    usage: "/switch <claude|codex|kimi>",
  },
  {
    name: "session",
    desc: "Show current session info (context, costs, events)",
    usage: "/session",
  },
  {
    name: "chat",
    desc: "Manage chat session (e.g. /chat clear)",
    usage: "/chat clear",
  },
  {
    name: "clear",
    desc: "Clear the terminal screen",
    usage: "/clear",
  },
  {
    name: "exit",
    alias: "q",
    desc: "Exit CCC",
    usage: "/exit",
  },
];

export function buildCompleter() {
  const names = SLASH_COMMANDS.map((c) => `/${c.name}`);
  const aliases = SLASH_COMMANDS
    .filter((c) => c.alias)
    .map((c) => `/${c.alias}`);
  const all = [...names, ...aliases];

  return function completer(line: string): [string[], string] {
    if (line.startsWith("/") || line === "/") {
      const hits = all.filter((n) => n.startsWith(line));
      return [hits.length ? hits : all, line];
    }
    return [[], line];
  };
}

export function resolveCommand(input: string): string {
  // Strip leading slash
  const bare = input.startsWith("/") ? input.slice(1) : input;
  const [name, ...rest] = bare.trim().split(/\s+/);

  // Resolve alias → full name
  const cmd = SLASH_COMMANDS.find(
    (c) => c.name === name || c.alias === name
  );
  if (!cmd) return input; // unknown, pass through
  return rest.length ? `${cmd.name} ${rest.join(" ")}` : cmd.name;
}
