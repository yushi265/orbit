// task ledger: 未消化・AC カバー・依存違反の検査（advisory）
// 「タスク全消化 or 意図的な持ち越しの明示」を Gate 3 の機械材料にする。

import type { LedgerTask } from "./parse";

export interface LedgerReport {
  total: number;
  done: number;
  remaining: LedgerTask[];
  /** spec の AC のうち、どのタスクにも割り当てられていない番号（spec 未指定時は []） */
  uncoveredAcs: string[];
  /** done なのに依存タスクが未完（順序の矛盾） */
  dependencyViolations: string[];
  /** 存在しないタスク id への依存 */
  unknownDeps: string[];
}

export function verifyLedger(tasks: LedgerTask[], specAcs: string[] | null): LedgerReport {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependencyViolations: string[] = [];
  const unknownDeps: string[] = [];

  for (const task of tasks) {
    for (const dep of task.deps) {
      const target = byId.get(dep);
      if (!target) {
        unknownDeps.push(`${task.id} が存在しないタスク ${dep} に依存している`);
        continue;
      }
      if (task.done && !target.done) {
        dependencyViolations.push(`${task.id} は done だが依存 ${dep} が未完（順序の矛盾）`);
      }
    }
  }

  const covered = new Set(tasks.flatMap((t) => t.acs));
  const uncoveredAcs = (specAcs ?? []).filter((ac) => !covered.has(ac));

  return {
    total: tasks.length,
    done: tasks.filter((t) => t.done).length,
    remaining: tasks.filter((t) => !t.done),
    uncoveredAcs,
    dependencyViolations,
    unknownDeps,
  };
}

/** Gate 3 添付用の整形（advisory） */
export function formatLedgerReport(r: LedgerReport): string {
  if (r.total === 0) return "[task ledger] 台帳なし（記法対象行 0 行・trivial ボルト互換）";
  const lines = [
    `[task ledger] タスク: ${r.total} 件（done ${r.done} / 残 ${r.remaining.length}${
      r.remaining.length > 0 ? `: ${r.remaining.map((t) => t.id).join(", ")}` : ""
    }）`,
  ];
  if (r.remaining.length > 0) {
    lines.push("  残タスクを意図的に持ち越す場合は progress.md にスコープ外理由を記載してください");
  }
  lines.push(
    `  未割当 AC: ${r.uncoveredAcs.length === 0 ? "なし" : r.uncoveredAcs.join(", ") + "（台帳のどのタスクにも割り当てられていない）"}`,
  );
  for (const v of r.dependencyViolations) lines.push(`  ✗ 依存違反: ${v}`);
  for (const u of r.unknownDeps) lines.push(`  ✗ 依存先不明: ${u}`);
  return lines.join("\n");
}
