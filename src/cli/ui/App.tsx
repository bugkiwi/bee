/**
 * Root Ink component — natural flow layout.
 *
 * Content flows top-to-bottom like a normal terminal:
 *   Banner
 *   status lines
 *   🐝 › [user input]         ← input follows content
 *   ── after submit ──
 *   › user message (dimmed)   ← becomes part of history
 *   🐝 thinking…              ← inline spinner
 *   AI response lines
 *   🐝 › [next input]         ← input moves down
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Box, Text, useApp, useFocus, useFocusManager, useInput, useStdin } from "ink";
import { TextInput } from "@inkjs/ui";
import stringWidth from "string-width";
import type { WorkspaceConfig } from "../../types/config.ts";
import type { ChatSession, ChatRenderHooks } from "../chat.ts";
import { SLASH_COMMANDS, resolveCommand } from "../commands.ts";
import { resolveClickAction } from "./click-behavior.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentLine {
  id: string;
  text: string;
  type: "banner" | "user" | "assistant" | "system" | "tool" | "shell" | "error" | "thinking";
}

export interface ProviderPickerOptions {
  options: string[];
  active: string;
}

interface SlashQuickOption {
  key: string;
  command: string;
  desc: string;
  commandText: string;
  requiresArgs: boolean;
}

interface ProviderQuickOption {
  key: string;
  label: string;
  desc: string;
}

type RenderItem =
  | { kind: "line"; line: ContentLine }
  | { kind: "thinking-group"; id: string; lines: ContentLine[] };

const INPUT_FOCUS_ID = "bee-input";
const THINKING_SUMMARY_MAX = 80;
const MAX_HISTORY_ENTRIES = 100;

interface MouseClickEvent {
  x: number;
  y: number;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

interface CursorReport {
  row: number;
  col: number;
}

interface TerminalExtractResult {
  clean: string;
  clicks: MouseClickEvent[];
  cursorReports: CursorReport[];
  remainder: string;
}

function extractTerminalEvents(data: string, remainder = ""): TerminalExtractResult {
  const input = remainder + data;
  const clicks: MouseClickEvent[] = [];
  const cursorReports: CursorReport[] = [];
  const cleanParts: string[] = [];
  let i = 0;

  while (i < input.length) {
    const escIndex = input.indexOf("\x1b", i);
    if (escIndex === -1) {
      cleanParts.push(input.slice(i));
      i = input.length;
      break;
    }

    cleanParts.push(input.slice(i, escIndex));
    const rest = input.slice(escIndex);

    const mouseMatch = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(rest);
    if (mouseMatch) {
      i = escIndex + mouseMatch[0].length;
      const rawCode = Number.parseInt(mouseMatch[1] ?? "", 10);
      const x = Number.parseInt(mouseMatch[2] ?? "", 10);
      const y = Number.parseInt(mouseMatch[3] ?? "", 10);
      const suffix = mouseMatch[4] ?? "";

      if (Number.isFinite(rawCode) && Number.isFinite(x) && Number.isFinite(y) && suffix === "M") {
        const isMotion = (rawCode & 32) !== 0;
        const isWheel = (rawCode & 64) !== 0;
        const button = rawCode & 3;
        if (!isMotion && !isWheel && button === 0) {
          clicks.push({
            x,
            y,
            shift: (rawCode & 4) !== 0,
            meta: (rawCode & 8) !== 0,
            ctrl: (rawCode & 16) !== 0,
          });
        }
      }
      continue;
    }

    const cursorMatch = /^\x1b\[(\d+);(\d+)R/.exec(rest);
    if (cursorMatch) {
      i = escIndex + cursorMatch[0].length;
      const row = Number.parseInt(cursorMatch[1] ?? "", 10);
      const col = Number.parseInt(cursorMatch[2] ?? "", 10);
      if (Number.isFinite(row) && Number.isFinite(col)) {
        cursorReports.push({ row, col });
      }
      continue;
    }

    const isMousePartial = /^\x1b\[<[\d;]*$/.test(rest);
    const isCursorPartial = /^\x1b\[\d*(?:;\d*)?$/.test(rest);
    if (isMousePartial || isCursorPartial) {
      return {
        clean: cleanParts.join(""),
        clicks,
        cursorReports,
        remainder: rest,
      };
    }

    // Preserve unknown/other escape sequences for Ink key parser.
    cleanParts.push("\x1b");
    i = escIndex + 1;
  }

  return {
    clean: cleanParts.join(""),
    clicks,
    cursorReports,
    remainder: "",
  };
}

function summarizeThinking(text: string): { summary: string; full: string; truncated: boolean } {
  const full = text.trimStart();
  if (full.length <= THINKING_SUMMARY_MAX) {
    return { summary: full, full, truncated: false };
  }
  return {
    summary: `${full.slice(0, THINKING_SUMMARY_MAX)}…`,
    full,
    truncated: true,
  };
}

function isGenericThinkingLine(text: string): boolean {
  const trimmed = text.trim();
  const withoutPrefix = trimmed.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return /^thinking(?:\.{3}|…)?$/i.test(withoutPrefix);
}

function isCollapsibleThinkingLine(text: string): boolean {
  if (isGenericThinkingLine(text)) return false;
  return /\S/.test(text);
}

function rowsForText(text: string, width: number): number {
  const w = Math.max(1, width);
  return Math.max(1, Math.ceil(stringWidth(text) / w));
}

function normalizeUserHistoryEntry(text: string): string | null {
  const withoutPrefix = text.replace(/^\s*›\s*/, "").trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

function extractHistoryFromTranscript(lines: Array<{ type: string; text: string }>): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.type !== "user") continue;
    const normalized = normalizeUserHistoryEntry(line.text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    history.push(normalized);
    if (history.length >= MAX_HISTORY_ENTRIES) break;
  }
  return history;
}

interface ThinkingCollapsibleLineProps {
  groupId: string;
  lines: ContentLine[];
  expanded: boolean;
  isActive: boolean;
  onToggle: () => void;
  onFocusChange: (focused: boolean) => void;
}

function ThinkingCollapsibleLine({
  groupId,
  lines,
  expanded,
  isActive,
  onToggle,
  onFocusChange,
}: ThinkingCollapsibleLineProps) {
  const summarySource = useMemo(() => {
    const firstContent = lines.find((line) => line.type === "thinking" && isCollapsibleThinkingLine(line.text));
    return firstContent ?? lines[0];
  }, [lines]);
  const summaryLineText = summarySource?.text ?? "";
  const { summary, full, truncated } = useMemo(() => summarizeThinking(summaryLineText), [summaryLineText]);

  const { isFocused } = useFocus({
    id: `thinking-${groupId}`,
    isActive,
  });

  useEffect(() => {
    onFocusChange(isFocused);
  }, [isFocused, onFocusChange]);

  useInput((input, key) => {
    if (!isActive || !isFocused) return;
    if (key.return || input === " ") {
      onToggle();
    }
  }, { isActive: isActive && isFocused });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? "yellow" : "gray"}
      paddingX={1}
    >
      <Text color={isFocused ? "white" : "gray"}>{`${expanded ? "▼" : "▶"} ${summary}`}</Text>
      {expanded ? (
        <Box flexDirection="column">
          {truncated ? <Text dimColor>{full}</Text> : null}
          {lines
            .filter((line) => line.id !== summarySource?.id)
            .map((line) => (
              <Text
                key={line.id}
                color={line.type === "tool" ? "cyan" : "gray"}
                dimColor={line.type !== "tool"}
              >
                {line.text.trimStart()}
              </Text>
            ))}
        </Box>
      ) : null}
    </Box>
  );
}

interface InputPanelProps {
  input: string;
  inputResetKey: number;
  statusDivider: string;
  statusInfo: string;
  suggestions: string[];
  isActive: boolean;
  inputDisabled: boolean;
  isProcessing: boolean;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  slashOptions: SlashQuickOption[];
  slashSelectedIndex: number;
  providerOptions: ProviderQuickOption[];
  providerSelectedIndex: number;
}

function InputPanel({
  input,
  inputResetKey,
  statusDivider,
  statusInfo,
  suggestions,
  isActive,
  inputDisabled,
  isProcessing,
  canSubmit,
  onChange,
  onSubmit,
  onFocusChange,
  slashOptions,
  slashSelectedIndex,
  providerOptions,
  providerSelectedIndex,
}: InputPanelProps) {
  const { isFocused } = useFocus({
    id: INPUT_FOCUS_ID,
    autoFocus: true,
    isActive,
  });

  useEffect(() => {
    onFocusChange(isFocused);
  }, [isFocused, onFocusChange]);

  const commandColWidth = useMemo(() => {
    const widths = slashOptions.map((opt) => stringWidth(opt.command));
    return Math.max(0, ...widths, 10);
  }, [slashOptions]);

  const providerColWidth = useMemo(() => {
    const widths = providerOptions.map((opt) => stringWidth(opt.label));
    return Math.max(0, ...widths, 10);
  }, [providerOptions]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? (isProcessing ? "yellow" : "cyan") : "gray"}
      paddingX={1}
      marginTop={1}
    >
      <Box>
        <Text>🐝</Text>
        <Text dimColor> › </Text>
        <TextInput
          key={`input-${inputResetKey}`}
          defaultValue={input}
          isDisabled={!isActive || !isFocused || inputDisabled}
          suggestions={suggestions}
          onChange={onChange}
          onSubmit={canSubmit && isFocused ? onSubmit : undefined}
        />
      </Box>
      {providerOptions.length > 0 ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {providerOptions.map((opt, index) => {
            const selected = index === providerSelectedIndex;
            const pad = " ".repeat(Math.max(1, providerColWidth - stringWidth(opt.label) + 2));
            return (
              <Text key={opt.key} color={selected ? "cyan" : undefined} bold={selected}>
                {`${opt.label}${pad}${opt.desc}`}
              </Text>
            );
          })}
          <Text dimColor>  ↑/↓ or Tab switch · Enter apply · Esc cancel</Text>
        </Box>
      ) : slashOptions.length > 0 ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {slashOptions.map((opt, index) => {
            const selected = index === slashSelectedIndex;
            const pad = " ".repeat(Math.max(1, commandColWidth - stringWidth(opt.command) + 2));
            return (
              <Text key={opt.key} color={selected ? "cyan" : undefined} bold={selected}>
                {`${opt.command}${pad}${opt.desc}`}
              </Text>
            );
          })}
          <Text dimColor>  ↑/↓ or Tab switch · Enter apply</Text>
        </Box>
      ) : null}
      <Text dimColor>{`  ${statusDivider}`}</Text>
      <Text dimColor>{`  ${statusInfo}`}</Text>
    </Box>
  );
}

export interface AppProps {
  config: WorkspaceConfig;
  chatSession: ChatSession;
  banner: string;
  initialStatus: string[];
  initialTranscript?: Array<{
    type: "user" | "assistant" | "tool" | "thinking" | "error";
    text: string;
  }>;
  onCommand: (cmd: string, args: string[]) => Promise<boolean>;
  onProviderPickerRequest: () => Promise<ProviderPickerOptions>;
  onProviderSelected: (provider: string) => Promise<void>;
  onExit: () => string[]; // returns summary lines to display before exit
}

// ─── App Component ──────────────────────────────────────────────────────────

export function App({
  config,
  chatSession,
  banner,
  initialStatus,
  initialTranscript = [],
  onCommand,
  onProviderPickerRequest,
  onProviderSelected,
  onExit,
}: AppProps) {
  const { exit } = useApp();
  const { focus, focusNext, focusPrevious } = useFocusManager();
  const { stdin, isRawModeSupported } = useStdin();
  const initialInputHistory = useMemo(
    () => extractHistoryFromTranscript(initialTranscript),
    [initialTranscript]
  );

  // ── State ──────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<ContentLine[]>(() => {
    const initial: ContentLine[] = [];
    for (const [i, line] of banner.split("\n").entries()) {
      initial.push({ id: `banner-${i}`, text: line, type: "banner" });
    }
    for (const [i, line] of initialStatus.entries()) {
      initial.push({ id: `status-${i}`, text: line, type: "system" });
    }
    for (const [i, line] of initialTranscript.entries()) {
      initial.push({ id: `resume-${i}`, text: line.text, type: line.type });
    }
    return initial;
  });

  const lineSeq = useRef(0);
  const nextLineId = useCallback((prefix: string) => {
    lineSeq.current += 1;
    return `${prefix}-${lineSeq.current}`;
  }, []);

  const [input, setInput] = useState("");
  const [inputResetKey, setInputResetKey] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [activeProvider, setActiveProvider] = useState(config.provider);
  const [history, setHistory] = useState<string[]>(() => initialInputHistory);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const [providerPicker, setProviderPicker] = useState<ProviderPickerOptions | null>(null);
  const [providerPickerIndex, setProviderPickerIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(true);
  const [focusedThinkingId, setFocusedThinkingId] = useState<string | null>(null);
  const [slashQuickIndex, setSlashQuickIndex] = useState(0);
  const [slashQuickDismissed, setSlashQuickDismissed] = useState(false);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(() => new Set());
  const mouseRemainderRef = useRef("");
  const cursorRowRef = useRef<number | null>(null);

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    for (let i = 0; i < lines.length;) {
      const line = lines[i]!;
      if (line.type === "thinking" && isCollapsibleThinkingLine(line.text)) {
        const grouped: ContentLine[] = [line];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j]!;
          if (next.type !== "thinking" && next.type !== "tool") break;
          grouped.push(next);
          j++;
        }
        items.push({
          kind: "thinking-group",
          id: `thinking-group-${line.id}`,
          lines: grouped,
        });
        i = j;
        continue;
      }
      items.push({ kind: "line", line });
      i += 1;
    }
    return items;
  }, [lines]);
  const thinkingGroupIds = useMemo(
    () => renderItems.filter((item) => item.kind === "thinking-group").map((item) => item.id),
    [renderItems]
  );


  // ── Helpers ────────────────────────────────────────────────────────────────

  const addLine = useCallback((text: string, type: ContentLine["type"]) => {
    setLines((prev) => [...prev, { id: nextLineId(type), text, type }]);
  }, [nextLineId]);

  const addLines = useCallback((texts: string[], type: ContentLine["type"]) => {
    setLines((prev) => [
      ...prev,
      ...texts.map((text) => ({
        id: nextLineId(type),
        text,
        type,
      })),
    ]);
  }, [nextLineId]);

  const updateLineById = useCallback((id: string, text: string) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, text } : line)));
  }, []);

  const replaceInput = useCallback((next: string) => {
    setInput(next);
    setInputResetKey((prev) => prev + 1);
  }, []);

  const focusInput = useCallback(() => {
    setTimeout(() => {
      focus(INPUT_FOCUS_ID);
      process.stdout.write("\u001b[6n");
    }, 0);
  }, [focus]);

  const toggleThinkingGroup = useCallback((groupId: string) => {
    setExpandedThinkingIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedThinkingIds((prev) => {
      const next = new Set<string>();
      for (const id of thinkingGroupIds) {
        if (prev.has(id)) next.add(id);
      }
      if (next.size === prev.size) {
        let same = true;
        for (const id of next) {
          if (!prev.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, [thinkingGroupIds]);

  useEffect(() => {
    if (!focusedThinkingId) return;
    if (thinkingGroupIds.includes(focusedThinkingId)) return;
    setFocusedThinkingId(null);
  }, [focusedThinkingId, thinkingGroupIds]);

  // ── Graceful exit: show summary then quit ──────────────────────────────────

  const doExit = useCallback(() => {
    const summaryLines = onExit();
    setIsExiting(true);
    setIsProcessing(true); // hide input
    setProviderPicker(null);
    setLines((prev) => [
      ...prev,
      ...summaryLines.map((text) => ({
        id: nextLineId("exit"),
        text,
        type: "system" as const,
      })),
    ]);
  }, [nextLineId, onExit]);

  // After summary lines render, exit on next tick
  useEffect(() => {
    if (isExiting) {
      const timer = setTimeout(() => exit(), 50);
      return () => clearTimeout(timer);
    }
  }, [isExiting, exit]);

  // ── Status info ────────────────────────────────────────────────────────────

  const model = config.model ?? "default";
  const sid = chatSession.beeSession?.id;
  const sidStr = sid ? ` · ${sid.slice(0, 8)}` : "";
  const msgCount = chatSession.messageCount;
  const msgsStr = msgCount > 0 ? ` · ${msgCount} msg${msgCount !== 1 ? "s" : ""}` : "";
  const statusInfo = `${activeProvider} · ${model}${sidStr}${msgsStr}`;

  const slashQuickOptions = useMemo<SlashQuickOption[]>(() => {
    const current = input.trimStart();
    if (!current.startsWith("/")) return [];

    const firstSpace = current.indexOf(" ");
    if (firstSpace >= 0) return [];

    const query = current.slice(1);
    const matches = SLASH_COMMANDS
      .filter(
        (c) =>
          !query ||
          c.name.startsWith(query) ||
          (c.alias ?? "").startsWith(query)
      )
      .map((c, index) => {
        if (!query) return { c, score: 0, index };

        const nameExact = c.name === query;
        const aliasExact = c.alias === query;
        const namePrefix = c.name.startsWith(query);
        const aliasPrefix = (c.alias ?? "").startsWith(query);

        const score =
          (nameExact ? 400 : 0) +
          (aliasExact ? 300 : 0) +
          (namePrefix ? 100 : 0) +
          (aliasPrefix ? 80 : 0);

        return { c, score, index };
      })
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      })
      .map((item) => item.c);

    return matches.slice(0, 8).map((cmd) => {
      const usageTail = cmd.usage.replace(`/${cmd.name}`, "").trim();
      const requiresArgs = usageTail.length > 0 && !usageTail.startsWith("[");
      const commandText = `/${cmd.name}${requiresArgs ? " " : ""}`;
      return {
        key: cmd.name,
        command: `/${cmd.name}`,
        desc: cmd.desc,
        commandText,
        requiresArgs,
      };
    });
  }, [input]);

  const slashQuickOptionsVisible =
    !isProcessing && !isExiting && !providerPicker && !slashQuickDismissed && slashQuickOptions.length > 0;

  const providerQuickOptions = useMemo<ProviderQuickOption[]>(() => {
    if (!providerPicker) return [];
    return providerPicker.options.map((provider) => ({
      key: provider,
      label: provider,
      desc: provider === providerPicker.active ? "active" : "switch",
    }));
  }, [providerPicker]);

  const slashSuggestionHints = slashQuickOptions.map((opt) => opt.commandText);
  const statusDivider = "─".repeat(Math.max(24, Math.min(96, statusInfo.length + 12)));

  const clickLayout = useMemo(() => {
    const termWidth = Math.max(20, process.stdout.columns ?? 80);
    const thinkingRanges: Array<{ id: string; start: number; end: number }> = [];
    let row = 1;

    for (const item of renderItems) {
      if (item.kind === "line") {
        row += rowsForText(item.line.text, termWidth);
        continue;
      }

      const lines = item.lines;
      const expanded = expandedThinkingIds.has(item.id);
      const summarySource = lines.find((line) => line.type === "thinking" && isCollapsibleThinkingLine(line.text)) ?? lines[0];
      const summaryLineText = summarySource?.text ?? "";
      const { summary, full, truncated } = summarizeThinking(summaryLineText);
      const innerWidth = Math.max(1, termWidth - 4);

      let h = 0;
      h += 1; // border top
      h += rowsForText(`${expanded ? "▼" : "▶"} ${summary}`, innerWidth);

      if (expanded) {
        if (truncated) h += rowsForText(full, innerWidth);
        for (const line of lines) {
          if (line.id === summarySource?.id) continue;
          h += rowsForText(line.text.trimStart(), innerWidth);
        }
      }

      h += 1; // border bottom

      const start = row;
      const end = row + h - 1;
      thinkingRanges.push({ id: item.id, start, end });
      row = end + 1;
    }

    const contentRows = row - 1;

    let optionsRows = 0;
    if (providerPicker) {
      optionsRows = 1 + providerQuickOptions.length + 1; // margin + list + hint
    } else if (slashQuickOptionsVisible) {
      optionsRows = 1 + slashQuickOptions.length + 1; // margin + list + hint
    }

    const inputPanelRows = 1 + 1 + 1 + optionsRows + 1 + 1 + 1;
    const inputStart = contentRows + 1;
    const inputEnd = contentRows + inputPanelRows;
    const inputCursorRow = contentRows + 3;

    return {
      totalRows: inputEnd,
      inputStart,
      inputEnd,
      inputCursorRow,
      thinkingRanges,
    };
  }, [
    expandedThinkingIds,
    providerPicker,
    providerQuickOptions.length,
    renderItems,
    slashQuickOptions.length,
    slashQuickOptionsVisible,
  ]);

  useEffect(() => {
    setSlashQuickDismissed(false);
  }, [input]);

  useEffect(() => {
    if (!slashQuickOptionsVisible) {
      setSlashQuickIndex(0);
      return;
    }
    setSlashQuickIndex(0);
  }, [slashQuickOptionsVisible, input]);

  // ── Streaming capture ─────────────────────────────────────────────────────

  const captureStream = useCallback(async (fn: () => Promise<void>): Promise<string> => {
    let buffer = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: typeof process.stdout.write }).write =
      function (chunk: unknown, ..._rest: unknown[]): boolean {
        if (typeof chunk === "string") {
          buffer += chunk;
        } else if (Buffer.isBuffer(chunk)) {
          buffer += chunk.toString();
        }
        return true;
      } as typeof process.stdout.write;

    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      buffer += args.map(String).join(" ") + "\n";
    };
    console.error = (...args: unknown[]) => {
      buffer += args.map(String).join(" ") + "\n";
    };

    try {
      await fn();
    } finally {
      (process.stdout as unknown as { write: typeof process.stdout.write }).write = origWrite;
      console.log = origLog;
      console.error = origError;
    }

    return buffer;
  }, []);

  const openProviderPicker = useCallback(async () => {
    setIsProcessing(true);
    const picker = await onProviderPickerRequest();
    if (picker.options.length === 0) {
      addLine("  No providers available.", "system");
      setIsProcessing(false);
      focusInput();
      return;
    }
    setProviderPickerIndex(Math.max(0, picker.options.indexOf(picker.active)));
    setProviderPicker(picker);
    setIsProcessing(false);
  }, [addLine, focusInput, onProviderPickerRequest]);

  const closeProviderPicker = useCallback(() => {
    setProviderPicker(null);
    setProviderPickerIndex(0);
    focusInput();
  }, [focusInput]);

  const submitProviderPicker = useCallback(async (index: number) => {
    if (!providerPicker) return;

    const chosen = providerPicker.options[index];
    setProviderPicker(null);
    setProviderPickerIndex(0);

    if (!chosen) {
      focusInput();
      return;
    }
    if (chosen === config.provider) {
      addLine(`  ${chosen} is already active.`, "system");
      focusInput();
      return;
    }

    setIsProcessing(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const output = await captureStream(async () => {
      await onProviderSelected(chosen);
    });

    if (output.trim()) {
      addLines(output.trimEnd().split("\n"), "system");
    }

    setActiveProvider(config.provider);
    focusInput();
    setIsProcessing(false);
  }, [addLine, addLines, captureStream, config.provider, focusInput, onProviderSelected, providerPicker]);

  const handleMouseClick = useCallback((event: MouseClickEvent) => {
    const policyActions = resolveClickAction(
      {
        isExiting,
        hasProviderPicker: Boolean(providerPicker),
        hasSlashQuickOptions: slashQuickOptionsVisible,
      },
      {
        shift: event.shift,
        ctrl: event.ctrl,
        meta: event.meta,
      }
    );

    for (const action of policyActions) {
      if (action === "none") return;
      if (action === "hit-test") continue;
      if (action === "close-provider-picker") {
        closeProviderPicker();
        return;
      }
      if (action === "dismiss-slash-quick-options") {
        setSlashQuickDismissed(true);
        continue;
      }
      if (action === "focus-input") {
        focusInput();
        return;
      }
      if (action === "focus-next") {
        focusNext();
        return;
      }
      if (action === "focus-previous") {
        focusPrevious();
        return;
      }
    }

    const cursorRow = cursorRowRef.current;
    if (!cursorRow) {
      focusInput();
      return;
    }

    const appTopRow = cursorRow - clickLayout.inputCursorRow + 1;
    const relativeRow = event.y - appTopRow + 1;

    if (relativeRow >= clickLayout.inputStart && relativeRow <= clickLayout.inputEnd) {
      focusInput();
      return;
    }

    const targetThinking = clickLayout.thinkingRanges.find(
      (range) => relativeRow >= range.start && relativeRow <= range.end
    );
    if (targetThinking) {
      if (focusedThinkingId === targetThinking.id) {
        toggleThinkingGroup(targetThinking.id);
      } else {
        focus(`thinking-${targetThinking.id}`);
      }
      return;
    }

    focusInput();
  }, [
    clickLayout.inputCursorRow,
    clickLayout.inputEnd,
    clickLayout.inputStart,
    clickLayout.thinkingRanges,
    closeProviderPicker,
    focus,
    focusInput,
    focusNext,
    focusPrevious,
    focusedThinkingId,
    isExiting,
    providerPicker,
    slashQuickOptionsVisible,
    toggleThinkingGroup,
  ]);
  const handleMouseClickRef = useRef(handleMouseClick);

  useEffect(() => {
    handleMouseClickRef.current = handleMouseClick;
  }, [handleMouseClick]);

  useEffect(() => {
    if (!isRawModeSupported || !stdin.isTTY) return;

    const enableMouse = "\u001b[?1000h\u001b[?1006h";
    const disableMouse = "\u001b[?1000l\u001b[?1006l";
    process.stdout.write(enableMouse);
    process.stdout.write("\u001b[6n");
    const originalRead = stdin.read.bind(stdin);
    const patchedRead = ((...args: unknown[]) => {
      const chunk = originalRead(...args as Parameters<typeof originalRead>);
      if (chunk === null) return null;
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const { clean, clicks, cursorReports, remainder } = extractTerminalEvents(
        data,
        mouseRemainderRef.current
      );
      mouseRemainderRef.current = remainder;
      if (cursorReports.length > 0) {
        cursorRowRef.current = cursorReports[cursorReports.length - 1]!.row;
      }
      for (const click of clicks) {
        handleMouseClickRef.current(click);
      }
      if (clean.length === 0) return null;
      if (typeof chunk === "string") return clean;
      return Buffer.from(clean, "utf8");
    }) as typeof stdin.read;
    (stdin as unknown as { read: typeof stdin.read }).read = patchedRead;

    return () => {
      (stdin as unknown as { read: typeof stdin.read }).read = originalRead;
      process.stdout.write(disableMouse);
      mouseRemainderRef.current = "";
    };
  }, [isRawModeSupported, stdin]);

  // ── Submit handler ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    replaceInput("");
    setHistoryIdx(-1);

    if (!trimmed) {
      focusInput();
      return;
    }

    // Add to history
    setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, MAX_HISTORY_ENTRIES));

    if (trimmed.startsWith("!")) {
      // ── Shell escape ──────────────────────────────────────────────────
      const shellCmd = value.replace(/^\s*!/, "");
      addLine(`  ! ${shellCmd}`, "shell");
      setIsProcessing(true);

      try {
        const proc = Bun.spawn(["sh", "-c", shellCmd], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: process.cwd(),
          env: process.env,
        });

        const out = await new Response(proc.stdout).text();
        const err = await new Response(proc.stderr).text();
        await proc.exited;

        if (out.trim()) {
          addLines(out.trimEnd().split("\n"), "system");
        }
        if (err.trim()) {
          addLines(err.trimEnd().split("\n"), "error");
        }
        if (proc.exitCode !== 0) {
          addLine(`  exit ${proc.exitCode}`, "system");
        }
      } catch (err) {
        addLine(`  Shell error: ${err}`, "error");
      } finally {
        setIsProcessing(false);
        focusInput();
      }
    } else if (trimmed.startsWith("/")) {
      // ── Slash commands ────────────────────────────────────────────────
      const resolved = resolveCommand(trimmed);
      const [cmd, ...args] = resolved.split(/\s+/);

      if (cmd === "exit") {
        doExit();
        return;
      }

      if (cmd === "clear") {
        setLines([]);
        focusInput();
        return;
      }

      if (cmd === "provider" && args.length === 0) {
        await openProviderPicker();
        return;
      }

      setIsProcessing(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      let shouldExit = false;
      const output = await captureStream(async () => {
        shouldExit = await onCommand(cmd ?? "", args);
      });

      if (output.trim()) {
        addLines(output.trimEnd().split("\n"), "system");
      }

      setActiveProvider(config.provider);

      if (shouldExit) {
        doExit();
        return;
      }

      setIsProcessing(false);
      focusInput();
    } else {
      // ── Chat message ──────────────────────────────────────────────────
      addLine(`  › ${trimmed}`, "user");
      const transcriptBatch: Array<{
        type: "user" | "assistant" | "tool" | "thinking" | "error";
        text: string;
      }> = [{ type: "user", text: `  › ${trimmed}` }];
      setIsProcessing(true);
      let responseBuffer = "";
      let assistantLineId: string | null = null;
      let lastThinking = "";

      const hooks: ChatRenderHooks = {
        onThinkingStart: (label) => {
          assistantLineId = null;
          const line = `  🌻 ${label}`;
          addLine(line, "thinking");
          transcriptBatch.push({ type: "thinking", text: line });
        },
        onThinking: (text) => {
          const note = text.trim();
          if (!note || note === lastThinking) return;
          assistantLineId = null;
          lastThinking = note;
          const line = `  💭 ${note}`;
          addLine(line, "thinking");
          transcriptBatch.push({ type: "thinking", text: line });
        },
        onTool: (name, preview) => {
          assistantLineId = null;
          const item = preview ? `${name} ${preview}` : name;
          const line = `  📖 ${item}`;
          addLine(line, "tool");
          transcriptBatch.push({ type: "tool", text: line });
        },
        onToolSummary: (summary) => {
          assistantLineId = null;
          const line = `  ${summary}`;
          addLine(line, "tool");
          transcriptBatch.push({ type: "tool", text: line });
        },
        onText: (text) => {
          responseBuffer += text;
          if (!assistantLineId) {
            assistantLineId = nextLineId("assistant-stream");
            setLines((prev) => [
              ...prev,
              {
                id: assistantLineId!,
                text: responseBuffer,
                type: "assistant",
              },
            ]);
          } else {
            updateLineById(assistantLineId, responseBuffer);
          }
        },
        onError: (text) => {
          assistantLineId = null;
          const line = `  ${text}`;
          addLine(line, "error");
          transcriptBatch.push({ type: "error", text: line });
        },
      };

      await chatSession.send(trimmed, hooks);

      if (!assistantLineId && responseBuffer.trim()) {
        addLines(responseBuffer.trimEnd().split("\n"), "assistant");
      }
      if (responseBuffer.trim()) {
        transcriptBatch.push({ type: "assistant", text: responseBuffer });
      }
      await chatSession.appendTranscript(transcriptBatch);
      setIsProcessing(false);
      focusInput();
    }
  }, [
    addLine,
    addLines,
    captureStream,
    chatSession,
    config.provider,
    doExit,
    onCommand,
    openProviderPicker,
    nextLineId,
    focusInput,
    replaceInput,
    updateLineById,
  ]);

  const applySlashQuickOption = useCallback((index: number) => {
    const selected = slashQuickOptions[index];
    if (!selected) return;
    if (selected.requiresArgs) {
      replaceInput(selected.commandText);
      return;
    }
    void handleSubmit(selected.commandText);
  }, [handleSubmit, replaceInput, slashQuickOptions]);

  useInput((_ch, key) => {
    if (isExiting || providerPicker || !slashQuickOptionsVisible) return;
    const total = slashQuickOptions.length;
    if (total === 0) return;

    if (key.downArrow || (key.tab && !key.shift)) {
      setSlashQuickIndex((prev) => (prev + 1) % total);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.upArrow || (key.tab && key.shift)) {
      setSlashQuickIndex((prev) => (prev - 1 + total) % total);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.escape) {
      setSlashQuickDismissed(true);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.return) {
      applySlashQuickOption(slashQuickIndex);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.rightArrow) {
      const selected = slashQuickOptions[slashQuickIndex];
      if (!selected) return;
      replaceInput(selected.commandText);
      focus(INPUT_FOCUS_ID);
    }
  });

  useInput((_ch, key) => {
    if (isExiting || !providerPicker) return;
    const total = providerPicker.options.length;
    if (total === 0) return;

    if (key.downArrow || (key.tab && !key.shift)) {
      setProviderPickerIndex((prev) => (prev + 1) % total);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.upArrow || (key.tab && key.shift)) {
      setProviderPickerIndex((prev) => (prev - 1 + total) % total);
      focus(INPUT_FOCUS_ID);
      return;
    }

    if (key.return) {
      void submitProviderPicker(providerPickerIndex);
      return;
    }

    if (key.escape) {
      closeProviderPicker();
      return;
    }

    if (key.ctrl && (_ch === "c" || _ch === "d")) {
      closeProviderPicker();
    }
  });

  // ── History navigation ─────────────────────────────────────────────────────

  useInput((_ch, key) => {
    if (isExiting || providerPicker || slashQuickOptionsVisible || isProcessing || !inputFocused) return;
    if (key.upArrow) {
      if (historyIdx === -1 && history.length > 0) {
        setSavedInput(input);
        setHistoryIdx(0);
        replaceInput(history[0]!);
      } else if (historyIdx >= 0 && historyIdx < history.length - 1) {
        const next = historyIdx + 1;
        setHistoryIdx(next);
        replaceInput(history[next]!);
      }
    } else if (key.downArrow) {
      if (historyIdx > 0) {
        const next = historyIdx - 1;
        setHistoryIdx(next);
        replaceInput(history[next]!);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        replaceInput(savedInput);
        setSavedInput("");
      }
    }
  });

  // ── Ctrl+C / Ctrl+D to exit ────────────────────────────────────────────────

  useInput((_ch, key) => {
    if (isExiting || providerPicker) return;
    if (key.ctrl && (_ch === "c" || _ch === "d")) {
      doExit();
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column">
      {/* All content lines */}
      {renderItems.map((item) => (
        item.kind === "thinking-group" ? (
          <ThinkingCollapsibleLine
            key={item.id}
            groupId={item.id}
            lines={item.lines}
            expanded={expandedThinkingIds.has(item.id)}
            isActive={!isExiting && !providerPicker && !slashQuickOptionsVisible}
            onToggle={() => toggleThinkingGroup(item.id)}
            onFocusChange={(focused) => {
              if (focused) {
                setFocusedThinkingId(item.id);
                return;
              }
              setFocusedThinkingId((prev) => (prev === item.id ? null : prev));
            }}
          />
        ) : (
          <Text
            key={item.line.id}
            dimColor={item.line.type === "user" || item.line.type === "shell"}
            color={
              item.line.type === "error"
                ? "red"
                : item.line.type === "tool"
                  ? "cyan"
                  : item.line.type === "thinking"
                    ? "gray"
                  : undefined
            }
          >
            {item.line.text}
          </Text>
        )
      ))}

      {!isExiting && (
        <InputPanel
          input={input}
          inputResetKey={inputResetKey}
          statusDivider={statusDivider}
          statusInfo={statusInfo}
          suggestions={slashSuggestionHints}
          isActive
          inputDisabled={Boolean(providerPicker)}
          isProcessing={isProcessing}
          canSubmit={!isProcessing && providerPicker === null && !slashQuickOptionsVisible}
          onChange={setInput}
          onSubmit={handleSubmit}
          onFocusChange={(focused) => {
            setInputFocused(focused);
            if (focused) setFocusedThinkingId(null);
          }}
          slashOptions={slashQuickOptionsVisible ? slashQuickOptions : []}
          slashSelectedIndex={slashQuickIndex}
          providerOptions={providerPicker ? providerQuickOptions : []}
          providerSelectedIndex={providerPickerIndex}
        />
      )}
    </Box>
  );
}
