import { describe, it, expect, beforeEach } from "bun:test";
import { StatusLine, STATUS_PRIORITY } from "../cli/statusline.ts";

describe("StatusLine.render()", () => {
  let s: StatusLine;
  beforeEach(() => { s = new StatusLine(); });

  it("returns empty string when no messages set", () => {
    expect(s.render()).toBe("");
  });

  it("returns the only message when one priority is set", () => {
    s.set(STATUS_PRIORITY.BASE, "  claude · sonnet");
    expect(s.render()).toBe("  claude · sonnet");
  });

  it("returns the highest-priority message when multiple are set", () => {
    s.set(STATUS_PRIORITY.BASE, "base");
    s.set(STATUS_PRIORITY.CLIPBOARD, "clipboard");
    expect(s.render()).toBe("clipboard");
  });

  it("WORKING beats CLIPBOARD beats MULTILINE beats BASE", () => {
    s.set(STATUS_PRIORITY.BASE,      "base");
    s.set(STATUS_PRIORITY.MULTILINE, "multiline");
    s.set(STATUS_PRIORITY.CLIPBOARD, "clipboard");
    s.set(STATUS_PRIORITY.WORKING,   "working");
    expect(s.render()).toBe("working");
  });

  it("falls back to next priority when highest is cleared", () => {
    s.set(STATUS_PRIORITY.BASE,    "base");
    s.set(STATUS_PRIORITY.WORKING, "working");
    s.clear(STATUS_PRIORITY.WORKING);
    expect(s.render()).toBe("base");
  });

  it("returns empty after all priorities cleared", () => {
    s.set(STATUS_PRIORITY.BASE,    "base");
    s.set(STATUS_PRIORITY.WORKING, "working");
    s.clear(STATUS_PRIORITY.WORKING);
    s.clear(STATUS_PRIORITY.BASE);
    expect(s.render()).toBe("");
  });

  it("clear of non-existent priority is a no-op", () => {
    s.set(STATUS_PRIORITY.BASE, "base");
    s.clear(STATUS_PRIORITY.WORKING); // was never set
    expect(s.render()).toBe("base");
  });

  it("updating an existing priority replaces its message", () => {
    s.set(STATUS_PRIORITY.BASE, "old");
    s.set(STATUS_PRIORITY.BASE, "new");
    expect(s.render()).toBe("new");
  });

  it("arbitrary numeric priorities work (higher always wins)", () => {
    s.set(0,  "low");
    s.set(99, "high");
    s.set(50, "mid");
    expect(s.render()).toBe("high");
    s.clear(99);
    expect(s.render()).toBe("mid");
    s.clear(50);
    expect(s.render()).toBe("low");
  });
});

describe("StatusLine.highestPriority", () => {
  let s: StatusLine;
  beforeEach(() => { s = new StatusLine(); });

  it("returns -1 when empty", () => {
    expect(s.highestPriority).toBe(-1);
  });

  it("returns the correct priority when one is set", () => {
    s.set(STATUS_PRIORITY.CLIPBOARD, "msg");
    expect(s.highestPriority).toBe(STATUS_PRIORITY.CLIPBOARD);
  });

  it("returns the max priority when several are set", () => {
    s.set(STATUS_PRIORITY.BASE,    "b");
    s.set(STATUS_PRIORITY.WORKING, "w");
    expect(s.highestPriority).toBe(STATUS_PRIORITY.WORKING);
  });

  it("drops after clearing highest", () => {
    s.set(STATUS_PRIORITY.BASE,    "b");
    s.set(STATUS_PRIORITY.WORKING, "w");
    s.clear(STATUS_PRIORITY.WORKING);
    expect(s.highestPriority).toBe(STATUS_PRIORITY.BASE);
  });
});

describe("STATUS_PRIORITY ordering", () => {
  it("WORKING > CLIPBOARD > MULTILINE > BASE", () => {
    expect(STATUS_PRIORITY.WORKING).toBeGreaterThan(STATUS_PRIORITY.CLIPBOARD);
    expect(STATUS_PRIORITY.CLIPBOARD).toBeGreaterThan(STATUS_PRIORITY.MULTILINE);
    expect(STATUS_PRIORITY.MULTILINE).toBeGreaterThan(STATUS_PRIORITY.BASE);
    expect(STATUS_PRIORITY.BASE).toBeGreaterThanOrEqual(0);
  });
});
