import { useState, useCallback } from "react";
import { Box, Text } from "ink";
import type { PlanSkeleton, SkeletonProgressEvent } from "../../types/skeleton.ts";

interface Props {
  skeleton: PlanSkeleton;
}

interface NodeRuntimeState {
  activeLeaf?: number;   // 1-indexed
  leafTotal?: number;
  elapsedMs?: number;
  startedAt?: number;    // Date.now() when node started
  summary?: string;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return m > 0 ? `${m}:${String(remS).padStart(2, "0")}` : `${s}s`;
}

function nodeIcon(status: string): string {
  switch (status) {
    case "done": return "✅";
    case "running": return "▶";
    case "failed": return "✗";
    default: return "○";
  }
}

function nodeColor(status: string): string {
  switch (status) {
    case "done": return "green";
    case "running": return "cyan";
    case "failed": return "red";
    default: return "gray";
  }
}

export function SkeletonProgressPanel({ skeleton: initialSkeleton }: Props) {
  const [skeleton, setSkeleton] = useState<PlanSkeleton>(initialSkeleton);
  const [runtimeState, setRuntimeState] = useState<Record<string, NodeRuntimeState>>({});

  const handleProgress = useCallback((event: SkeletonProgressEvent) => {
    if (event.type === "node:start") {
      setSkeleton((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === event.nodeId ? { ...n, status: "running" } : n
        ),
      }));
      setRuntimeState((prev) => ({
        ...prev,
        [event.nodeId]: { startedAt: Date.now() },
      }));
    } else if (event.type === "node:done") {
      setSkeleton((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === event.nodeId ? { ...n, status: "done" } : n
        ),
      }));
      setRuntimeState((prev) => ({
        ...prev,
        [event.nodeId]: { ...prev[event.nodeId], elapsedMs: event.elapsed, summary: event.summary },
      }));
    } else if (event.type === "leaf:start") {
      setRuntimeState((prev) => {
        const cur = prev[event.nodeId] ?? {};
        return {
          ...prev,
          [event.nodeId]: {
            ...cur,
            activeLeaf: (cur.activeLeaf ?? 0) + 1,
          },
        };
      });
    }
  }, []);

  // Expose handler for external wiring (AgentLoop onProgress callback)
  (SkeletonProgressPanel as unknown as { _handleProgress?: typeof handleProgress })._handleProgress = handleProgress;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Plan Progress</Text>
      {skeleton.nodes.map((node, idx) => {
        const rt = runtimeState[node.id];
        const elapsed = rt?.elapsedMs
          ? formatElapsed(rt.elapsedMs)
          : rt?.startedAt
          ? formatElapsed(Date.now() - rt.startedAt)
          : null;

        return (
          <Box key={node.id} flexDirection="column" marginTop={idx === 0 ? 1 : 0}>
            <Box>
              <Text color={nodeColor(node.status)}>
                {nodeIcon(node.status)}{" "}
              </Text>
              <Text bold={node.status === "running"} color={nodeColor(node.status)}>
                Node {idx + 1}: {node.title}
              </Text>
              {elapsed && (
                <Text color="gray"> ({elapsed})</Text>
              )}
            </Box>
            {node.status === "running" && rt?.activeLeaf !== undefined && rt.leafTotal !== undefined && (
              <Box marginLeft={3}>
                <Text color="gray">
                  • leaf {rt.activeLeaf}/{rt.leafTotal}...
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
