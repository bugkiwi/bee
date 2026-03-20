import { expect, test, describe } from "bun:test";
import { checkCommand } from "../utils/command-gate.ts";

describe("checkCommand", () => {
  test("allows bun test commands", () => {
    expect(checkCommand("bun test")).toBe("allowed");
    expect(checkCommand("bun test --watch")).toBe("allowed");
  });

  test("allows bun run commands", () => {
    expect(checkCommand("bun run build")).toBe("allowed");
  });

  test("allows git read commands", () => {
    expect(checkCommand("git diff HEAD")).toBe("allowed");
    expect(checkCommand("git log --oneline")).toBe("allowed");
    expect(checkCommand("git status")).toBe("allowed");
  });

  test("allows ls", () => {
    expect(checkCommand("ls")).toBe("allowed");
    expect(checkCommand("ls -la")).toBe("allowed");
  });

  test("allows cat", () => {
    expect(checkCommand("cat README.md")).toBe("allowed");
  });

  test("requires confirm for rm", () => {
    expect(checkCommand("rm -rf dist")).toBe("confirm");
  });

  test("requires confirm for curl", () => {
    expect(checkCommand("curl https://example.com")).toBe("confirm");
  });

  test("requires confirm for arbitrary scripts", () => {
    expect(checkCommand("./deploy.sh")).toBe("confirm");
  });

  test("requires confirm for npm install (not in allowlist)", () => {
    expect(checkCommand("npm install")).toBe("confirm");
  });

  test("allows npm test and npm run", () => {
    expect(checkCommand("npm test")).toBe("allowed");
    expect(checkCommand("npm run lint")).toBe("allowed");
  });

  test("allows tsc type-check", () => {
    expect(checkCommand("npx tsc --noEmit")).toBe("allowed");
    expect(checkCommand("tsc --noEmit")).toBe("allowed");
  });
});
