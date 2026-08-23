// Stop guard: ターン終了時の「進行中ボルトの放置」判定（観測のみ）
// Stop hook から呼ばれ、「AI が続けるべき作業（next = run-stage）が停滞したままターンを
// 終えようとしていないか」を決定論判定する。判定は純粋関数・収集（fs）は cli.ts に隔離。
//
// 安全設計（v2 の縮約移植）:
// - 邪魔しない側に倒す: 非ボルト作業・人間待ち（blocking gate / 空 [Answer]:）・parked・
//   state 不正はすべて allow（fail-open）。
// - 同一地点での block は cap 回まで（無限 nudge ループの防止）。
// - reason は「承認済み作業の継続」形に固定（override 型の文言にしない）。

import { next } from "../next";
import type { StageGraph, TierGateMap, WorkflowState } from "../types";

/** 1 ボルト分の観測スナップショット（収集は cli.ts） */
export interface BoltSnapshot {
  ticket: string;
  state: WorkflowState;
  /** audit 行数。進捗 signature の材料（report が打たれると増える） */
  auditLines: number;
  /** questions.md に空 [Answer]: が残っているか（不在は false/undefined） */
  hasOpenQuestions?: boolean;
}

/** 前回 Stop 時の記憶（揮発 JSON。state/.stop-guard/memory.json に置く） */
export interface StopGuardMemory {
  signature: string | null;
  blockCount: number;
}

export const EMPTY_MEMORY: StopGuardMemory = { signature: null, blockCount: 0 };

export interface StopDecision {
  decision: "allow" | "block";
  reason: string;
  /** 書き戻す新しい記憶（呼び出し側が永続化する） */
  memory: StopGuardMemory;
}

/** questions.md に「回答待ちの空 [Answer]:」が残っているか（質問ファイル連携） */
export function hasOpenAnswerTag(md: string): boolean {
  return md.split("\n").some((line) => /^\[Answer\]:\s*$/.test(line.trim()));
}

interface RunningBolt {
  ticket: string;
  stage: string;
  name: string;
  auditLines: number;
}

/** 「AI が続けるべき作業が残るボルト」を抽出（人間待ち・parked・不正 state は除外 = allow 要因） */
function collectRunning(
  bolts: BoltSnapshot[],
  graph: StageGraph,
  tierMap: TierGateMap,
): RunningBolt[] {
  const running: RunningBolt[] = [];
  for (const b of bolts) {
    if (b.state.parked) continue; // 正規中断
    if (b.hasOpenQuestions) continue; // 人間の回答待ち
    const d = next(b.state, graph, tierMap);
    if (d.kind !== "run-stage") continue; // gate=人間待ち / done / error(fail-open)
    running.push({ ticket: b.ticket, stage: d.stage, name: d.name, auditLines: b.auditLines });
  }
  return running;
}

/**
 * ターン終了の可否を決定論判定する。
 * - Running ボルトなし → allow（記憶クリア）
 * - signature（ticket:stage:audit行数）が前回から変化 → allow（進捗あり・カウンタリセット）
 * - 同一 signature（停滞）→ block。ただし cap 回を超えたら allow（フェイルオープン）
 */
export function decideStop(
  bolts: BoltSnapshot[],
  memory: StopGuardMemory,
  cap: number,
  graph: StageGraph,
  tierMap: TierGateMap,
): StopDecision {
  const running = collectRunning(bolts, graph, tierMap);
  if (running.length === 0) {
    return { decision: "allow", reason: "進行中ボルトなし（または人間待ち・parked）", memory: EMPTY_MEMORY };
  }

  const signature = running.map((r) => `${r.ticket}:${r.stage}:${r.auditLines}`).join("|");
  if (memory.signature !== signature) {
    // 進捗があった（または初回の基準点）。健全なターン終了を邪魔しない。
    return {
      decision: "allow",
      reason: "進捗あり（signature 変化・カウンタリセット）",
      memory: { signature, blockCount: 1 },
    };
  }

  const blockCount = memory.blockCount + 1;
  if (blockCount > cap) {
    return {
      decision: "allow",
      reason: `フェイルオープン（同一地点で ${cap} 回 block 済み。人間の介入を待つ）`,
      memory: { signature, blockCount },
    };
  }

  const detail = running
    .map((r) => `${r.ticket} は Stage ${r.stage}「${r.name}」進行中`)
    .join(" / ");
  return {
    decision: "block",
    reason:
      `${detail}。承認済み作業の続きがあります。次の一手を実行するか、` +
      `中断する場合は park で正規中断してください（pnpm -C .claude/aidlc report <state> park）`,
    memory: { signature, blockCount },
  };
}
