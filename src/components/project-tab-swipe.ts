// IssuesのProjectタブを横スワイプで切り替える判定。DOMに依存しない部分を純関数にしてテストする。

// これより短い横移動はタップや縦スクロールの揺れとみなす。
export const SWIPE_MIN_DISTANCE = 60;
// 画面端から始まる横スワイプはブラウザの「戻る／進む」に任せる。
export const SWIPE_EDGE_GUARD = 24;

export type TouchPoint = { x: number; y: number };

// 左スワイプで次のタブ（+1）、右スワイプで前のタブ（-1）。スワイプでなければ 0。
export function swipeTabStep(
  start: TouchPoint,
  end: TouchPoint,
  viewportWidth: number,
): -1 | 0 | 1 {
  if (start.x < SWIPE_EDGE_GUARD || start.x > viewportWidth - SWIPE_EDGE_GUARD) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return 0;
  // 斜めの動きは縦スクロールとみなす。
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

// 端のタブでは止める（ループしない）。
export function adjacentTabId(tabIds: string[], currentId: string, step: -1 | 1): string | null {
  const index = tabIds.indexOf(currentId);
  if (index < 0) return null;
  return tabIds[index + step] ?? null;
}

// 文字入力欄はカーソル移動・範囲選択に横スワイプを使うので除く。
// Issue行のステータス選択（select）やボタンは、指が動けばタップにならないので対象に含める。
const SWIPE_IGNORED_SELECTOR =
  'input, textarea, [contenteditable="true"], [role="dialog"], .project-tabs';

// 文字入力欄・ダイアログ・横スクロールする要素（Board、タブ列など）の上で始まったスワイプは無視する。
export function isSwipeBlocked(target: Element | null, boundary: Element): boolean {
  for (let element = target; element && element !== boundary; element = element.parentElement) {
    if (element.matches(SWIPE_IGNORED_SELECTOR)) return true;
    if (element.scrollWidth > element.clientWidth + 1) {
      const overflowX = element.ownerDocument.defaultView?.getComputedStyle(element).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
  }
  return false;
}
