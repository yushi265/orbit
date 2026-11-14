import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { burndownChart, burndownRows } from "./cycle-burndown";
import { CycleBurndownSection } from "./OrbitApp";
import { declarationsFor, parseStyleRules } from "./css-rules.test-fixtures";
import type { CycleProgressDayViewModel, CycleProgressViewModel } from "../shared/view-models";

// CYC-16 AC-5: Cycle詳細のバーンダウン（SVG＋日別の表）
const tracked = (
  date: string,
  scope: number,
  completed: number,
  added = 0,
  removed = 0,
  canceled = 0,
): CycleProgressDayViewModel => ({
  date,
  tracked: true,
  scope,
  completed,
  canceled,
  remaining: scope - completed - canceled,
  added,
  removed,
});
const untracked = (date: string): CycleProgressDayViewModel => ({
  date,
  tracked: false,
  scope: null,
  completed: null,
  canceled: null,
  remaining: null,
  added: null,
  removed: null,
});
const progress: CycleProgressViewModel = {
  cycleId: "cycle-1",
  trackedFrom: "2026-11-11",
  days: [
    untracked("2026-11-10"),
    tracked("2026-11-11", 4, 0),
    tracked("2026-11-12", 4, 0),
    untracked("2026-11-13"),
    tracked("2026-11-14", 5, 2, 2, 1, 1),
  ],
};

describe("burndownChart", () => {
  const chart = burndownChart(progress, "2026-11-19");

  it("[代表値] 横軸は開始日〜Cycle終了日（10日）、縦軸の最大は記録上の最大scope", () => {
    expect(chart.totalDays).toBe(10);
    expect(chart.maxY).toBe(5);
  });

  it("[代表値] Remaining折れ線は tracked:false の日で分断する", () => {
    expect(chart.remainingSegments.map((segment) => segment.length)).toEqual([2, 1]);
    expect(chart.remainingSegments[0][0]).toEqual({ x: chart.x(1), y: chart.y(4) });
    expect(chart.remainingSegments[1][0]).toEqual({ x: chart.x(4), y: chart.y(2) });
  });

  it("[代表値] 理想線は記録開始日のscopeからCycle終了日の0へ", () => {
    expect(chart.ideal).toEqual({ x1: chart.x(1), y1: chart.y(4), x2: chart.x(9), y2: chart.y(0) });
  });

  it("[代表値] tracked:false の連続区間を「記録なし」の範囲として返す", () => {
    expect(chart.untrackedRanges).toEqual([
      { from: 0, to: 0 },
      { from: 3, to: 3 },
    ]);
  });

  it("[代表値] Scope changeは added / removed がある日だけ印を出す", () => {
    expect(chart.scopeMarks).toEqual([{ index: 4, date: "2026-11-14", added: 2, removed: 1 }]);
  });

  it("[境界値] 1日だけ・scope 0 でもゼロ除算せず描ける", () => {
    const single = burndownChart(
      { cycleId: "c", trackedFrom: "2026-11-10", days: [tracked("2026-11-10", 0, 0)] },
      "2026-11-10",
    );
    expect(single.totalDays).toBe(1);
    expect(single.maxY).toBe(1);
    expect(Number.isFinite(single.x(0))).toBe(true);
    expect(Number.isFinite(single.y(0))).toBe(true);
  });

  it("[代表値] 全日 tracked:false なら線も理想線も出さない", () => {
    const none = burndownChart(
      { cycleId: "c", trackedFrom: "2026-11-12", days: [untracked("2026-11-10")] },
      "2026-11-12",
    );
    expect(none.remainingSegments).toEqual([]);
    expect(none.ideal).toBeNull();
  });
});

describe("burndownRows", () => {
  it("[代表値] 日付・Completed・Remaining・Scope change（0は—、記録なしは記録なし）", () => {
    expect(burndownRows(progress.days)).toEqual([
      { date: "11/10", completed: "記録なし", remaining: "記録なし", scopeChange: "記録なし" },
      { date: "11/11", completed: "0", remaining: "4", scopeChange: "—" },
      { date: "11/12", completed: "0", remaining: "4", scopeChange: "—" },
      { date: "11/13", completed: "記録なし", remaining: "記録なし", scopeChange: "記録なし" },
      { date: "11/14", completed: "2", remaining: "2", scopeChange: "+2 / −1" },
    ]);
  });
});

describe("CycleBurndownSection", () => {
  const render = (value: CycleProgressViewModel | undefined) =>
    renderToStaticMarkup(
      createElement(CycleBurndownSection, {
        progress: value,
        cycleName: "Cycle 3",
        endDate: "2026-11-19",
      }),
    );

  it("[同値分割] 記録あり → SVG（role=img・件数入りaria-label）と日別の表", () => {
    const markup = render(progress);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Cycle 3のバーンダウン。残り2件、記録開始時4件"');
    expect(markup).toContain("日別の数値");
    expect(markup).toContain("+2 / −1");
  });

  it("[同値分割] 一部記録なし → 記録開始日の注記とグラフ上の「記録なし」", () => {
    const markup = render(progress);
    expect(markup).toContain("11/11より前は記録なし（この機能の導入前）");
    expect(markup.match(/class="burndown-untracked-label"[^>]*>記録なし</g)).toHaveLength(2);
  });

  it("[同値分割] 記録なし（undefined） → 空状態", () => {
    const markup = render(undefined);
    expect(markup).toContain("このCycleの日別記録はまだありません");
    expect(markup).not.toContain("<svg");
  });
});

describe("burndown CSS", () => {
  const rules = parseStyleRules();
  it("[代表値] SVGは幅100%で伸縮し、表は横スクロールのラッパーに入る", () => {
    expect(declarationsFor(rules, ".burndown-chart").get("width")).toBe("100%");
    expect(declarationsFor(rules, ".burndown-table-wrap").get("overflow-x")).toBe("auto");
  });
  it("[代表値] 理想線は破線（色だけで区別しない）", () => {
    expect(declarationsFor(rules, ".burndown-ideal").get("stroke-dasharray")).toBeDefined();
  });
});
