export type ShortcutAction =
  | "command"
  | "create"
  | "focus-search"
  | "focus-filter"
  | "focus-display"
  | "toggle-board"
  | "toggle-selection"
  | "close"
  | "help";

export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  editable?: boolean;
  /** 1文字ショートカットの ON/OFF（省略時は ON）。 */
  singleKeyEnabled?: boolean;
  /** フォーカスが SELECT / combobox / listbox にあるか。 */
  onSelectControl?: boolean;
}

export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = "orbit.singleKeyShortcuts";

type ShortcutStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ShortcutStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** localStorage が "off" のときだけ OFF。未設定・他の値・例外は ON。 */
export function readSingleKeyShortcuts(storage: ShortcutStorage | undefined = defaultStorage()) {
  try {
    return storage?.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSingleKeyShortcuts(
  enabled: boolean,
  storage: ShortcutStorage | undefined = defaultStorage(),
) {
  try {
    storage?.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // 保存できなくても画面上の状態だけ切り替える
  }
}

export function shortcutActionFor(event: ShortcutEventLike): ShortcutAction | null {
  const key = event.key.toLowerCase();
  const modifier = Boolean(event.metaKey || event.ctrlKey);
  if (modifier && key === "k") return "command";
  if (modifier && key === "f") return "focus-search";
  if (modifier && key === "b") return "toggle-board";
  if (key === "escape") return "close";
  if (event.editable || modifier) return null;
  if (event.singleKeyEnabled === false || event.onSelectControl) return null;
  if (key === "c") return "create";
  if (key === "f") return "focus-filter";
  if (key === "v" && event.shiftKey) return "focus-display";
  if (key === "x") return "toggle-selection";
  if (event.key === "?") return "help";
  return null;
}

export function nextCommandIndex(length: number, current: number, delta: number): number {
  if (length <= 0) return -1;
  return (current + delta + length) % length;
}

export function shortcutModifierLabel(platform: string | undefined): "⌘" | "Ctrl" {
  return platform && /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}
