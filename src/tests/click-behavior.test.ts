import { describe, expect, it } from "bun:test";
import { resolveClickAction } from "../cli/ui/click-behavior.ts";

describe("resolveClickAction", () => {
  it("defaults plain click to hit-test dispatch", () => {
    const actions = resolveClickAction(
      {
        isExiting: false,
        hasProviderPicker: false,
        hasSlashQuickOptions: false,
      },
      { shift: false, ctrl: false, meta: false }
    );
    expect(actions).toEqual(["hit-test"]);
  });

  it("closes provider picker first", () => {
    const actions = resolveClickAction(
      {
        isExiting: false,
        hasProviderPicker: true,
        hasSlashQuickOptions: false,
      },
      { shift: false, ctrl: false, meta: false }
    );
    expect(actions).toEqual(["close-provider-picker"]);
  });

  it("dismisses slash quick options then focuses input", () => {
    const actions = resolveClickAction(
      {
        isExiting: false,
        hasProviderPicker: false,
        hasSlashQuickOptions: true,
      },
      { shift: false, ctrl: false, meta: false }
    );
    expect(actions).toEqual(["dismiss-slash-quick-options", "focus-input"]);
  });

  it("supports modifier click focus traversal", () => {
    const prev = resolveClickAction(
      {
        isExiting: false,
        hasProviderPicker: false,
        hasSlashQuickOptions: false,
      },
      { shift: true, ctrl: false, meta: false }
    );
    expect(prev).toEqual(["focus-previous"]);

    const next = resolveClickAction(
      {
        isExiting: false,
        hasProviderPicker: false,
        hasSlashQuickOptions: false,
      },
      { shift: false, ctrl: true, meta: false }
    );
    expect(next).toEqual(["focus-next"]);
  });

  it("ignores click while exiting", () => {
    const actions = resolveClickAction(
      {
        isExiting: true,
        hasProviderPicker: true,
        hasSlashQuickOptions: true,
      },
      { shift: false, ctrl: false, meta: false }
    );
    expect(actions).toEqual(["none"]);
  });
});
