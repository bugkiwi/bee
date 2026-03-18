/**
 * Read a ReadableStream line by line, calling onLine for each non-empty line.
 * Returns all collected lines (including empty ones for position tracking).
 */
export async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void
): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const result: string[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        result.push(line);
        if (onLine && line.trim()) onLine(line);
      }
    }
    if (buffer) {
      result.push(buffer);
      if (onLine && buffer.trim()) onLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}
