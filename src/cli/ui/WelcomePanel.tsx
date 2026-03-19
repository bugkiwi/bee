import { Box, Text, useStdout } from "ink";

export function WelcomePanel({ provider, useRtk }: { provider: string; useRtk: boolean }) {
  const { stdout } = useStdout();
  const panelWidth = Math.max(18, Math.min(46, (stdout.columns ?? 80) - 4));

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      width={panelWidth}
      marginBottom={1}
    >
      <Text wrap="truncate-end">
        <Text color="yellow">(◉ω◉)</Text>
        <Text>{"  "}</Text>
        <Text color="yellow" bold>BEE</Text>
        <Text dimColor>{" — Busy Buzzing Agent"}</Text>
      </Text>
      <Text wrap="truncate-end">
        <Text dimColor>provider: </Text>
        <Text color="cyan">{provider}</Text>
        {useRtk ? <Text color="yellow"> RTK</Text> : null}
      </Text>
      <Text dimColor wrap="truncate-end">type /help for commands, /exit to quit</Text>
    </Box>
  );
}
