export interface ClickBehaviorState {
  isExiting: boolean;
  hasProviderPicker: boolean;
  hasSlashQuickOptions: boolean;
}

export interface ClickModifiers {
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

export type ClickAction =
  | "none"
  | "hit-test"
  | "close-provider-picker"
  | "dismiss-slash-quick-options"
  | "focus-input"
  | "focus-next"
  | "focus-previous";

/**
 * Mouse click handling policy for Ink UI.
 *
 * Notes:
 * - Terminal mouse y/x coordinates are not reliable for sub-tree hit testing in non-fullscreen Ink.
 * - Unmodified click delegates to hit-test logic in App for region-based focus.
 * - Focus traversal via click remains available through modifier clicks.
 */
export function resolveClickAction(
  state: ClickBehaviorState,
  modifiers: ClickModifiers
): ClickAction[] {
  if (state.isExiting) return ["none"];

  if (state.hasProviderPicker) {
    return ["close-provider-picker"];
  }

  if (state.hasSlashQuickOptions) {
    return ["dismiss-slash-quick-options", "focus-input"];
  }

  if (modifiers.shift) return ["focus-previous"];
  if (modifiers.ctrl || modifiers.meta) return ["focus-next"];

  return ["hit-test"];
}
