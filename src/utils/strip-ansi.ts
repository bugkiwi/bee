// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}
