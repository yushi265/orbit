import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  SWIPE_EDGE_GUARD,
  SWIPE_MIN_DISTANCE,
  adjacentTabId,
  isSwipeBlocked,
  swipeTabStep,
  tabSlideDirection,
} from "./project-tab-swipe";

// IssuesのProjectタブを横スワイプで切り替える判定。

const WIDTH = 390;
const start = { x: 200, y: 300 };

describe("swipeTabStep", () => {
  it.each([
    ["左へ最小距離ちょうど", -SWIPE_MIN_DISTANCE, 0, 1],
    ["左へ最小距離-1", -(SWIPE_MIN_DISTANCE - 1), 0, 0],
    ["右へ最小距離ちょうど", SWIPE_MIN_DISTANCE, 0, -1],
    ["右へ最小距離-1", SWIPE_MIN_DISTANCE - 1, 0, 0],
    ["横:縦=1.5:1ちょうどは縦スクロール扱い", -90, 60, 0],
    ["横:縦が1.5:1より横寄り", -91, 60, 1],
    ["縦スクロール", -10, 200, 0],
  ] as const)("[境界値] %s → %s", (_label, dx, dy, expected) => {
    expect(swipeTabStep(start, { x: start.x + dx, y: start.y + dy }, WIDTH)).toBe(expected);
  });

  it.each([
    ["左端ガード内", SWIPE_EDGE_GUARD - 1, 0],
    ["左端ガードちょうど", SWIPE_EDGE_GUARD, 1],
    ["右端ガード内", WIDTH - SWIPE_EDGE_GUARD + 1, 0],
    ["右端ガードちょうど", WIDTH - SWIPE_EDGE_GUARD, 1],
  ] as const)("[境界値] 開始位置が%s → %s", (_label, x, expected) => {
    expect(swipeTabStep({ x, y: 300 }, { x: x - 100, y: 300 }, WIDTH)).toBe(expected);
  });
});

describe("adjacentTabId", () => {
  const ids = ["p1", "p2", "all"];
  it.each([
    ["真ん中から次", "p2", 1, "all"],
    ["真ん中から前", "p2", -1, "p1"],
    ["先頭から前（止まる）", "p1", -1, null],
    ["末尾から次（止まる）", "all", 1, null],
    ["タブに無いID", "gone", 1, null],
  ] as const)("[境界値] %s", (_label, current, step, expected) => {
    expect(adjacentTabId(ids, current, step)).toBe(expected);
  });
});

describe("isSwipeBlocked", () => {
  const dom = new JSDOM(`<div id="area">
    <div class="project-tabs"><button id="tab">tab</button></div>
    <input id="input" />
    <div role="dialog"><span id="in-dialog">x</span></div>
    <div id="row"><span id="cell">row</span><select id="status"></select></div>
  </div>`);
  const doc = dom.window.document;
  const area = doc.getElementById("area")!;
  it.each([
    ["タブ列", "tab", true],
    ["入力欄", "input", true],
    ["ダイアログ内", "in-dialog", true],
    ["Issue行", "cell", false],
    ["Issue行のステータス選択", "status", false],
  ] as const)("[デシジョンテーブル] %s → %s", (_label, id, expected) => {
    expect(isSwipeBlocked(doc.getElementById(id), area)).toBe(expected);
  });

  it("[代表値] 横スクロールする要素の上では無視する", () => {
    const row = doc.getElementById("row")!;
    Object.defineProperty(row, "scrollWidth", { value: 600, configurable: true });
    Object.defineProperty(row, "clientWidth", { value: 300, configurable: true });
    row.style.overflowX = "auto";
    expect(isSwipeBlocked(doc.getElementById("cell"), area)).toBe(true);
    row.style.overflowX = "hidden";
    expect(isSwipeBlocked(doc.getElementById("cell"), area)).toBe(false);
  });
});

describe("tabSlideDirection", () => {
  const ids = ["p1", "p2", "all"];
  it.each([
    ["右のタブへ", "p1", "p2", "next"],
    ["2つ右へ", "p1", "all", "next"],
    ["左のタブへ", "all", "p2", "prev"],
    ["同じタブ", "p2", "p2", null],
    ["移動元がタブに無い", "gone", "p2", null],
    ["移動先がタブに無い", "p1", "gone", null],
  ] as const)("[デシジョンテーブル] %s → %s", (_label, from, to, expected) => {
    expect(tabSlideDirection(ids, from, to)).toBe(expected);
  });
});
