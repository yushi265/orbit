// artifact guard: Stage 完了の証跡を決定論検証する（advisory）
// stage-graph.json の produces[] を根拠に「Stage の成果物が実在するか」を機械が見る。
// AI の自己申告（stage-done の report）だけで完了扱いにしない。
//
// 設計方針（既存モジュールと同じ）:
// - 判定はすべて純粋関数。fs / git の evidence 収集は CLI（state/cli.ts）側に隔離する。
// - Phase A は advisory: 不足を警告するだけで遷移は拒否しない（hard stop は lefthook/CI/人間）。

import type { ProducesSpec, StageGraph, StageNode, WorkflowState } from "../types";

/** 検証に使う実リポジトリの観測データ。収集（fs/git）は CLI 側の責務 */
export interface GuardEvidence {
  /** git ls-files 相当の追跡ファイル一覧（repo root 相対） */
  files: string[];
  /** git diff --numstat 相当の出力（`added\tdeleted\tpath` 行群） */
  diffNumstat: string;
}

export interface GuardContext {
  ticket: string;
  state: WorkflowState;
  evidence: GuardEvidence;
}

export interface GuardFinding {
  stage: string;
  kind: ProducesSpec["kind"];
  detail: string;
}

// テストファイル判定（プロジェクトのテスト命名に合わせて調整する）。
// 既定は主要言語の慣習をカバー: Go(_test.go) / JS・TS(.test|.spec) / Python(test_*.py, *_test.py) /
// Ruby(_spec.rb) / Rust(_test.rs) / JVM(*Test.(java|kt))。移植先の命名が違えばここを直す。
const TEST_FILE_PATTERN =
  /(_test\.(go|py|rs)|test_[^/]*\.py|\.test\.[jt]sx?|\.spec\.[jt]sx?|_spec\.rb|(Test|Tests)\.(java|kt|kts))$/;

/**
 * 最小 glob マッチャ（`**` = 任意階層 / `*` = セグメント内任意のみ対応）。
 * 依存ゼロ方針のため fast-glob 等は使わない。produces の glob はこの 2 記法で足りる。
 */
export function matchGlob(pattern: string, path: string): boolean {
  const regex = pattern
    .split("**")
    .map((part) =>
      part
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]"),
    )
    .join(".*");
  return new RegExp(`^${regex}$`).test(path);
}

/**
 * exemptWhen（`key=value`）を state に照合する。キーが state に無い（undefined）場合は
 * 免除しない（検証を続ける安全側）。value は true/false のみ boolean 解釈。
 */
export function isExempt(exemptWhen: string | undefined, state: WorkflowState): boolean {
  if (!exemptWhen) return false;
  const eq = exemptWhen.indexOf("=");
  if (eq === -1) return false;
  const key = exemptWhen.slice(0, eq);
  const raw = exemptWhen.slice(eq + 1);
  const value: unknown = raw === "true" ? true : raw === "false" ? false : raw;
  return (state as unknown as Record<string, unknown>)[key] === value;
}

/** numstat 出力からテストファイル（*_test.go / *.test.ts / *.spec.ts 等）の追加行数を合算 */
export function countTestDeltaLines(numstat: string): number {
  let total = 0;
  for (const line of numstat.split("\n")) {
    const [added, , path] = line.split("\t");
    if (!path || !TEST_FILE_PATTERN.test(path)) continue;
    const n = Number(added);
    if (Number.isFinite(n)) total += n; // binary は "-" → NaN → 加算しない
  }
  return total;
}

function resolveGlob(spec: ProducesSpec, ticket: string): string {
  return (spec.glob ?? "").replaceAll("<TICKET>", ticket);
}

/** stage が実行対象か（skip 宣言・planKey=false の stage は検証しない） */
function isStagePlanned(stage: StageNode, state: WorkflowState): boolean {
  if (state.stageStatus[stage.id] === "skipped") return false;
  if (stage.planKey && !state[stage.planKey]) return false;
  return true;
}

type CheckResult = { ok: boolean; detail: string };

function evaluate(spec: ProducesSpec, ctx: GuardContext): CheckResult {
  const glob = resolveGlob(spec, ctx.ticket);
  switch (spec.kind) {
    case "exists": {
      const hit = ctx.evidence.files.some((f) => matchGlob(glob, f));
      return { ok: hit, detail: `exists ${glob}` };
    }
    case "test-delta": {
      const lines = countTestDeltaLines(ctx.evidence.diffNumstat);
      return { ok: lines > 0, detail: `test-delta（テスト追加行 ${lines}）` };
    }
    case "progress-removed": {
      const remaining = ctx.evidence.files.filter((f) => matchGlob(glob, f));
      return {
        ok: remaining.length === 0,
        detail: remaining.length === 0 ? `progress-removed ${glob}` : `progress-removed ${glob}（残存: ${remaining.join(", ")}）`,
      };
    }
  }
}

/** 1 Stage の produces を検証し、不足のみを findings として返す（全充足なら空配列） */
export function verifyStage(stage: StageNode, ctx: GuardContext): GuardFinding[] {
  if (!stage.produces || !isStagePlanned(stage, ctx.state)) return [];
  const findings: GuardFinding[] = [];
  for (const spec of stage.produces) {
    if (isExempt(spec.exemptWhen, ctx.state)) continue;
    const result = evaluate(spec, ctx);
    if (!result.ok) findings.push({ stage: stage.id, kind: spec.kind, detail: result.detail });
  }
  return findings;
}

/** 全 Stage の findings を集約（Gate 3 前の一括検証・stage-done 時は verifyStage 単体を使う） */
export function verifyAllStages(graph: StageGraph, ctx: GuardContext): GuardFinding[] {
  return graph.stages.flatMap((s) => verifyStage(s, ctx));
}

/** 同一 glob が後続 stage の progress-removed 対象なら、exists 側は評価しない（ライフサイクル後段優先） */
function removalTargets(graph: StageGraph, ticket: string): Set<string> {
  const targets = new Set<string>();
  for (const stage of graph.stages) {
    for (const spec of stage.produces ?? []) {
      if (spec.kind === "progress-removed") targets.add(resolveGlob(spec, ticket));
    }
  }
  return targets;
}

/**
 * Gate 3 直前の証跡チェックリスト（人間の審査材料）。
 * - skip された stage は N/A 表示（誤検知させない）
 * - 除去対象（progress-removed の glob）と同一 glob の exists は「除去対象」表示にして
 *   時点矛盾（spec 作成時は存在すべき / Gate 3 時点では除去済みが正）の誤検知を防ぐ
 */
export function formatGate3Checklist(graph: StageGraph, ctx: GuardContext): string {
  const removals = removalTargets(graph, ctx.ticket);
  const rows: string[] = [
    `[artifact guard] Gate 3 証跡チェックリスト（ticket: ${ctx.ticket}）`,
    "| stage | check | 結果 |",
    "|---|---|---|",
  ];
  for (const stage of graph.stages) {
    if (!stage.produces) continue;
    const planned = isStagePlanned(stage, ctx.state);
    for (const spec of stage.produces) {
      const glob = resolveGlob(spec, ctx.ticket);
      const label = spec.glob ? `${spec.kind} ${glob}` : spec.kind;
      if (!planned) {
        rows.push(`| ${stage.id} | ${label} | N/A（stage skip） |`);
        continue;
      }
      if (isExempt(spec.exemptWhen, ctx.state)) {
        rows.push(`| ${stage.id} | ${label} | N/A（${spec.exemptWhen}） |`);
        continue;
      }
      if (spec.kind === "exists" && removals.has(glob)) {
        rows.push(`| ${stage.id} | ${label} | （除去対象・後段 stage で検証） |`);
        continue;
      }
      const result = evaluate(spec, ctx);
      rows.push(`| ${stage.id} | ${label} | ${result.ok ? "✓" : `✗ 不足（${result.detail}）`} |`);
    }
  }
  return rows.join("\n");
}
