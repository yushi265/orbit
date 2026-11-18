// スマホ幅でOrbitを開いたとき、最初の画面をHomeではなくIssues一覧にする。
// 判定はページ読み込みごとに1回だけ。開いた後にHomeへ移動したときは引き戻さない。

export const MOBILE_ENTRY_MEDIA = "(max-width: 767px)";

type EntryWindow = Pick<Window, "location" | "matchMedia">;

const pendingByWindow = new WeakMap<object, boolean>();

// 初回の呼び出しで判定を決め、以降は同じ答えを返す（consume されるまで）。
export function isMobileIssuesEntryPending(win: EntryWindow, initialSection: string): boolean {
  if (!pendingByWindow.has(win)) {
    pendingByWindow.set(
      win,
      initialSection === "home" &&
        win.location.pathname === "/" &&
        win.matchMedia?.(MOBILE_ENTRY_MEDIA).matches === true,
    );
  }
  return pendingByWindow.get(win) === true;
}

export function consumeMobileIssuesEntry(win: EntryWindow) {
  pendingByWindow.set(win, false);
}
