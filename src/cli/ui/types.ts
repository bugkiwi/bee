import type { MetaGroupType } from "./content.ts";
import type { TranscriptLineMeta } from "../../types/transcript.ts";

export interface ContentLine {
  id: string;
  text: string;
  type: "user" | "assistant" | "system" | "tool" | "shell" | "error" | "thinking";
  meta?: TranscriptLineMeta;
  isFirstAssistantInTurn?: boolean;
}

export interface CommandRenderLine {
  text: string;
  type: ContentLine["type"];
  meta?: TranscriptLineMeta;
  isFirstAssistantInTurn?: boolean;
}

export interface CommandResult {
  shouldExit?: boolean;
  lines?: CommandRenderLine[];
}

export interface ProviderPickerOptions {
  options: string[];
  active: string;
}

export interface SlashQuickOption {
  key: string;
  command: string;
  desc: string;
  commandText: string;
  requiresArgs: boolean;
}

export interface ProviderQuickOption {
  key: string;
  label: string;
  desc: string;
}

export type RenderItem =
  | { kind: "line"; line: ContentLine }
  | { kind: "meta-group"; id: string; groupType: MetaGroupType; lines: ContentLine[] };

export interface MouseClickEvent {
  x: number;
  y: number;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface MouseScrollEvent {
  x: number;
  y: number;
  direction: "up" | "down";
  ctrl: boolean;
  shift: boolean;
}

export interface CursorReport {
  row: number;
  col: number;
}

export interface TerminalExtractResult {
  clean: string;
  clicks: MouseClickEvent[];
  scrolls: MouseScrollEvent[];
  cursorReports: CursorReport[];
  remainder: string;
}

export const INPUT_FOCUS_ID = "bee-input";
export const THINKING_SUMMARY_MAX = 80;
export const MAX_HISTORY_ENTRIES = 100;
export const WELCOME_PANEL_ROWS = 6;
