import { useEffect, useMemo } from "react";
import { Box, Text, useFocus, useStdout } from "ink";
import { TextInput } from "@inkjs/ui";
import stringWidth from "string-width";
import type { PlanStatus } from "../../types/plan.ts";
import type { InputPlanSummary } from "./App.tsx";
import type { ProviderQuickOption, SlashQuickOption } from "./types.ts";
import { INPUT_FOCUS_ID } from "./types.ts";

function getPlanStatusMeta(status: PlanStatus): {
	color: string;
	label: string;
} {
	switch (status) {
		case "running":
			return { color: "yellow", label: "▶ running" };
		case "completed":
			return { color: "green", label: "✓ done" };
		case "failed":
			return { color: "red", label: "× failed" };
		case "paused":
			return { color: "cyan", label: "◆ verify" };
		default:
			return { color: "gray", label: "• pending" };
	}
}

interface InputPanelProps {
  input: string;
  inputResetKey: number;
  statusDivider: string;
  statusInfo: string;
  suggestions: string[];
  planSummary?: InputPlanSummary | null;
  isActive: boolean;
  inputDisabled: boolean;
  isProcessing: boolean;
  canSubmit: boolean;
  imageHint?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  slashOptions: SlashQuickOption[];
  slashSelectedIndex: number;
  providerOptions: ProviderQuickOption[];
  providerSelectedIndex: number;
}

export function InputPanel({
  input,
  inputResetKey,
  statusDivider,
  statusInfo,
  suggestions,
  planSummary,
  isActive,
  inputDisabled,
  isProcessing,
  canSubmit,
  imageHint,
  onChange,
  onSubmit,
  onFocusChange,
  slashOptions,
  slashSelectedIndex,
  providerOptions,
  providerSelectedIndex,
}: InputPanelProps) {
  const { stdout } = useStdout();
  const panelWidth = Math.max(20, (stdout.columns ?? 80) - 2);
  const planStatusMeta = planSummary
    ? getPlanStatusMeta(planSummary.taskStatus)
    : null;
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

  const dividerText = useMemo(() => {
    const available = Math.max(8, (stdout.columns ?? 80) - 8);
    return `  ${statusDivider.slice(0, available)}`;
  }, [statusDivider, stdout.columns]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? (isProcessing ? "yellow" : "cyan") : "gray"}
      paddingX={1}
      marginTop={1}
      width={panelWidth}
    >
      <Box width="100%">
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
      {planSummary && planStatusMeta ? (
        <Box marginTop={1} paddingLeft={1} width="100%">
          <Text wrap="truncate-end">
            <Text color="cyan" bold>{`◇ plan ${planSummary.planHash}`}</Text>
            <Text dimColor>{` · `}</Text>
            <Text color="green">{planSummary.progressLabel}</Text>
            <Text dimColor>{` · `}</Text>
            <Text color={planStatusMeta.color}>{planStatusMeta.label}</Text>
            <Text dimColor>{` · `}</Text>
            <Text color="white">{planSummary.taskTitle}</Text>
          </Text>
        </Box>
      ) : null}
      {providerOptions.length > 0 ? (
        <Box flexDirection="column" marginTop={1} paddingLeft={2} width="100%">
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
        <Box flexDirection="column" marginTop={1} paddingLeft={2} width="100%">
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
      <Text dimColor wrap="truncate-end">{dividerText}</Text>
      <Text dimColor>{imageHint ? "  Image in clipboard · ctrl+v to paste" : `  ${statusInfo}`}</Text>
    </Box>
  );
}
