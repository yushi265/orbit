import { describe, expect, it } from "vitest";
import { consumeMobileIssuesEntry, isMobileIssuesEntryPending } from "./mobile-entry";

// スマホ幅で開いたときの最初の画面をIssues一覧にする判定。

function fakeWindow(pathname: string, mobile: boolean) {
  return {
    location: { pathname } as Location,
    matchMedia: (query: string) =>
      ({ matches: mobile && query === "(max-width: 767px)" }) as MediaQueryList,
  };
}

describe("isMobileIssuesEntryPending", () => {
  it.each([
    ["スマホ幅で / を開く", "/", true, "home", true],
    ["PC幅で / を開く", "/", false, "home", false],
    ["スマホ幅で /issues を開く", "/issues", true, "issues", false],
    ["スマホ幅で /cycles を開く", "/cycles", true, "cycles", false],
  ] as const)("[デシジョンテーブル] %s → %s", (_label, path, mobile, section, expected) => {
    expect(isMobileIssuesEntryPending(fakeWindow(path, mobile), section)).toBe(expected);
  });

  it("[状態遷移] 判定はページ読み込みごとに1回。consume後はHomeへ戻っても引き戻さない", () => {
    const win = fakeWindow("/", true);
    expect(isMobileIssuesEntryPending(win, "home")).toBe(true);
    expect(isMobileIssuesEntryPending(win, "home")).toBe(true);
    consumeMobileIssuesEntry(win);
    expect(isMobileIssuesEntryPending(win, "home")).toBe(false);
  });

  it("[状態遷移] 最初に別画面で開いたページは、あとでHomeを開いても対象にしない", () => {
    const win = fakeWindow("/issues", true);
    expect(isMobileIssuesEntryPending(win, "issues")).toBe(false);
    win.location.pathname = "/";
    expect(isMobileIssuesEntryPending(win, "home")).toBe(false);
  });
});
