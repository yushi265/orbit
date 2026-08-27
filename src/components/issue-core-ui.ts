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
}

export function shortcutActionFor(event: ShortcutEventLike): ShortcutAction | null {
  const key = event.key.toLowerCase();
  const modifier = Boolean(event.metaKey || event.ctrlKey);
  if (modifier && key === "k") return "command";
  if (modifier && key === "f") return "focus-search";
  if (modifier && key === "b") return "toggle-board";
  if (key === "escape") return "close";
  if (event.editable || modifier) return null;
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
