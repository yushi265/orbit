import type { CycleProgressDayViewModel, CycleProgressViewModel } from "../shared/view-models";

// CYC-16: バーンダウンの座標計算と表の行。描画（SVG）はCycleBurndownSectionが担う。
export const BURNDOWN_WIDTH = 600;
export const BURNDOWN_HEIGHT = 200;
const PAD = { top: 12, right: 12, bottom: 32, left: 32 };

export interface BurndownPoint {
  x: number;
  y: number;
}

export interface BurndownChart {
  totalDays: number;
  maxY: number;
  x: (index: number) => number;
  y: (value: number) => number;
  remainingSegments: BurndownPoint[][];
  ideal: { x1: number; y1: number; x2: number; y2: number } | null;
  scopeMarks: Array<{ index: number; date: string; added: number; removed: number }>;
  untrackedRanges: Array<{ from: number; to: number }>;
}

function dayIndex(start: string, date: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

export function burndownChart(progress: CycleProgressViewModel, endDate: string): BurndownChart {
  const start = progress.days[0].date;
  const totalDays = Math.max(dayIndex(start, endDate) + 1, progress.days.length, 1);
  const trackedDays = progress.days.filter((day) => day.tracked);
  const maxY = Math.max(1, ...trackedDays.map((day) => day.scope ?? 0));
  const plotWidth = BURNDOWN_WIDTH - PAD.left - PAD.right;
  const plotHeight = BURNDOWN_HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (totalDays > 1 ? (index / (totalDays - 1)) * plotWidth : 0);
  const y = (value: number) => PAD.top + plotHeight * (1 - value / maxY);

  const remainingSegments: BurndownPoint[][] = [];
  let segment: BurndownPoint[] = [];
  progress.days.forEach((day, index) => {
    if (!day.tracked) {
      if (segment.length) remainingSegments.push(segment);
      segment = [];
      return;
    }
    segment.push({ x: x(index), y: y(day.remaining ?? 0) });
  });
  if (segment.length) remainingSegments.push(segment);

  const firstTracked = progress.days.findIndex((day) => day.tracked);
  const ideal =
    firstTracked === -1
      ? null
      : {
          x1: x(firstTracked),
          y1: y(progress.days[firstTracked].scope ?? 0),
          x2: x(totalDays - 1),
          y2: y(0),
        };
  const scopeMarks = progress.days.flatMap((day, index) =>
    day.tracked && ((day.added ?? 0) > 0 || (day.removed ?? 0) > 0)
      ? [{ index, date: day.date, added: day.added ?? 0, removed: day.removed ?? 0 }]
      : [],
  );
  const untrackedRanges: Array<{ from: number; to: number }> = [];
  progress.days.forEach((day, index) => {
    if (day.tracked) return;
    const last = untrackedRanges[untrackedRanges.length - 1];
    if (last && last.to === index - 1) last.to = index;
    else untrackedRanges.push({ from: index, to: index });
  });
  return { totalDays, maxY, x, y, remainingSegments, ideal, scopeMarks, untrackedRanges };
}

export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

export function scopeChangeLabel(added: number, removed: number): string {
  if (added === 0 && removed === 0) return "—";
  return [added > 0 ? `+${added}` : null, removed > 0 ? `−${removed}` : null]
    .filter(Boolean)
    .join(" / ");
}

export function burndownRows(days: CycleProgressDayViewModel[]) {
  return days.map((day) =>
    day.tracked
      ? {
          date: shortDate(day.date),
          completed: String(day.completed),
          remaining: String(day.remaining),
          scopeChange: scopeChangeLabel(day.added ?? 0, day.removed ?? 0),
        }
      : {
          date: shortDate(day.date),
          completed: "記録なし",
          remaining: "記録なし",
          scopeChange: "記録なし",
        },
  );
}
