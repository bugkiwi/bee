/**
 * Simple line-by-line stdin reader using async iteration.
 * Works correctly with both piped and interactive input.
 */
export class StdinReader {
  private readonly lines: string[] = [];
  private resolve: ((line: string) => void) | null = null;
  private eof = false;

  constructor() {
    this.init();
  }

  private init() {
    let buffer = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/\r$/, "");
        if (this.resolve) {
          const r = this.resolve;
          this.resolve = null;
          r(line);
        } else {
          this.lines.push(line);
        }
      }
    });
    process.stdin.on("end", () => {
      this.eof = true;
      if (this.resolve) {
        const r = this.resolve;
        this.resolve = null;
        r("");
      }
    });
    process.stdin.resume();
  }

  readLine(): Promise<string> {
    if (this.lines.length > 0) {
      return Promise.resolve(this.lines.shift()!);
    }
    if (this.eof) {
      return Promise.resolve("");
    }
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  async prompt(question: string): Promise<string> {
    process.stdout.write(question);
    return this.readLine();
  }
}
