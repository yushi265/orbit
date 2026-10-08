import { useEffect, useRef } from "react";
import {
  readSingleKeyShortcuts,
  shortcutActionFor,
  type ShortcutAction,
} from "../../components/issue-core-ui";
import { isImeComposing } from "../../components/ime";

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

// キーボードショートカットの判定と振り分け（REFACTOR-ui-architecture Phase 3b-1a）。
// 抑止条件は呼び出し側が 1 つの boolean にまとめて渡す。抑止中でなければ、ハンドラの有無にかかわらず
// ショートカットの既定動作を止める（現行の keydown effect と同じ）。
export function useShortcutDispatcher(blocked: boolean, handlers: ShortcutHandlers): void {
  const latest = useRef({ blocked, handlers });
  latest.current = { blocked, handlers };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeComposing(event)) return;
      const target = event.target as HTMLElement;
      const editing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const onSelectControl =
        target.tagName === "SELECT" ||
        target.closest?.('[role="combobox"], [role="listbox"]') != null;
      const action = shortcutActionFor({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        editable: editing,
        singleKeyEnabled: readSingleKeyShortcuts(),
        onSelectControl,
      });
      if (!action || latest.current.blocked) return;
      event.preventDefault();
      latest.current.handlers[action]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
