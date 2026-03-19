import { useEffect, useMemo, useState } from "react";
import { Text } from "ink";

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
    <Text color="gray" wrap="truncate-end">
      {`  ${THINKING_STATUS_FRAMES[frameIndex]} ${text}`}
    </Text>
  );
}
