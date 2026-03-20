import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { CONTENT_LABEL_GAP, CONTENT_LABEL_WIDTH } from "./content.ts";

const THINKING_STATUS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function ThinkingStatusLine({ label }: { label: string }) {
  const [frameIndex, setFrameIndex] = useState(0);
  const text = useMemo(() => label.trim() || "thinking...", [label]);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % THINKING_STATUS_FRAMES.length);
    }, 90);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box width="100%">
      <Box width={CONTENT_LABEL_WIDTH} marginRight={CONTENT_LABEL_GAP} flexShrink={0}>
        <Text color="gray" dimColor>
          THINKING
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color="gray" wrap="truncate-end">
          {`${THINKING_STATUS_FRAMES[frameIndex]} ${text}`}
        </Text>
      </Box>
    </Box>
  );
}
