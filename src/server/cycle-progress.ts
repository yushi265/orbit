import type { CycleStatus } from "./model";
import type { CycleProgressDayViewModel, CycleProgressViewModel } from "../shared/view-models";

// CYC-16: Cycleの日別進捗。Mutation後の観測を「その日の終わりの値」として1日1点に畳み込む。
export interface CycleProgressPoint {
  date: string;
  scope: number;
  completed: number;
  canceled: number;
  added: number;
  removed: number;
}

export interface CycleProgressRecord {
  userId: string;
  cycleId: string;
  trackedFrom: string;
  lastIssueIds: string[];
  points: CycleProgressPoint[];
  closed: boolean;
}

export interface CycleProgressObservation {
  userId: string;
  cycleId: string;
  date: string;
  issueIds: string[];
  completed: number;
  canceled: number;
}

export function localDateKey(timestamp: number, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(timestamp);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** 変化がなければ null を返す（呼び出し側は何も書かない）。 */
export function observeCycleProgress(
  record: CycleProgressRecord | undefined,
  observation: CycleProgressObservation,
  options: { close?: boolean } = {},
): CycleProgressRecord | null {
  if (record?.closed) return null;
  const issueIds = [...new Set(observation.issueIds)].sort();
  const counts = {
    scope: issueIds.length,
    completed: observation.completed,
    canceled: observation.canceled,
  };
  const closed = Boolean(options.close);
  if (!record)
    return {
      userId: observation.userId,
      cycleId: observation.cycleId,
      trackedFrom: observation.date,
      lastIssueIds: closed ? [] : issueIds,
      points: [{ date: observation.date, ...counts, added: 0, removed: 0 }],
      closed,
    };

  const previous = new Set(record.lastIssueIds);
  const current = new Set(issueIds);
  const added = issueIds.filter((id) => !previous.has(id)).length;
  const removed = record.lastIssueIds.filter((id) => !current.has(id)).length;
  const last = record.points[record.points.length - 1];
  const unchanged =
    added === 0 &&
    removed === 0 &&
    last.scope === counts.scope &&
    last.completed === counts.completed &&
    last.canceled === counts.canceled;
  if (unchanged && !closed) return null;

  const points = unchanged
    ? record.points
    : last.date >= observation.date
      ? [
          ...record.points.slice(0, -1),
          {
            date: last.date,
            ...counts,
            added: last.added + added,
            removed: last.removed + removed,
          },
        ]
      : [...record.points, { date: observation.date, ...counts, added, removed }];
  // 確定後は差分計算に使わないため、所属IDを捨ててSnapshotを小さく保つ。
  return { ...record, lastIssueIds: closed ? [] : issueIds, points, closed };
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

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

export function expandCycleProgress(
  record: CycleProgressRecord,
  cycle: { startsAt: number; endsAt: number; status: CycleStatus; completedAt: number | null },
  now: number,
  timeZone: string,
): CycleProgressViewModel {
  const start = localDateKey(cycle.startsAt, timeZone);
  const cycleEnd = localDateKey(cycle.endsAt, timeZone);
  const today = localDateKey(now, timeZone);
  let end =
    cycle.status === "completed" && cycle.completedAt !== null
      ? localDateKey(cycle.completedAt, timeZone)
      : today < cycleEnd
        ? today
        : cycleEnd;
  if (end < start) end = start;

  const days: CycleProgressDayViewModel[] = [];
  let pointIndex = -1;
  for (let date = start; date <= end; date = nextDate(date)) {
    while (pointIndex + 1 < record.points.length && record.points[pointIndex + 1].date <= date)
      pointIndex += 1;
    const point = record.points[pointIndex];
    if (date < record.trackedFrom || !point) {
      days.push(untracked(date));
      continue;
    }
    const sameDay = point.date === date;
    days.push({
      date,
      tracked: true,
      scope: point.scope,
      completed: point.completed,
      canceled: point.canceled,
      remaining: point.scope - point.completed - point.canceled,
      added: sameDay ? point.added : 0,
      removed: sameDay ? point.removed : 0,
    });
  }
  return { cycleId: record.cycleId, trackedFrom: record.trackedFrom, days };
}
