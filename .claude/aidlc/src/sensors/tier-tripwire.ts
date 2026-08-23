// tier tripwire: Tier 昇格勧告 sensor（advisory）
// 「作業中に Tier 1 要素に触れることが判明したら、即座に停止して再宣言する」（risk-tiers.md）を
// パス（glob）+ 内容（新規追加行の regex）で機械化する。判定は純粋関数・収集は dispatch.ts。
//
// 安全設計:
// - 勧告が出るのは「トリガー該当 × engine state あり × 宣言 tier が 2/3」の 1 組合せのみ。
//   非 AI-DLC 作業（state なし）・Tier 1 宣言済みは無音（alarm fatigue を作らない）。
// - 既存行への接触では鳴らさない（新規追加行のみ評価）。壊れた trigger は無視（fail-open）。

import { matchGlob } from "../guard/artifacts";
import type { Tier } from "../types";

export interface TierTrigger {
  id: string;
  glob: string;
  /** 新規追加行に適用する regex（大文字小文字は区別しない） */
  contentPattern: string;
}

export interface TriggersData {
  version: number;
  source: string;
  triggers: TierTrigger[];
}

export interface TripwireFinding {
  triggerId: string;
  file: string;
  message: string;
}

/**
 * 編集ファイルの新規追加行を Tier 1 トリガー表に照合し、昇格勧告を返す。
 * declaredTier は Running な engine state 群の最小 tier（state なしは null = 無音）。
 */
export function checkTierTripwire(
  file: string,
  addedLines: string[],
  declaredTier: Tier | null,
  triggers: TierTrigger[],
): TripwireFinding[] {
  if (declaredTier === null || declaredTier === 1) return [];
  const findings: TripwireFinding[] = [];
  for (const trigger of triggers) {
    if (!matchGlob(trigger.glob, file)) continue;
    let pattern: RegExp;
    try {
      pattern = new RegExp(trigger.contentPattern, "i");
    } catch {
      continue; // 壊れた trigger 定義は無視（fail-open。drift guard / doctor が可視化を担う）
    }
    if (!addedLines.some((line) => pattern.test(line))) continue;
    findings.push({
      triggerId: trigger.id,
      file,
      message:
        `${file} は Tier 1 要素（${trigger.id}）に該当する可能性があります。宣言は Tier ${declaredTier}。` +
        `risk-tiers.md に従い停止して再宣言してください（昇格はいつでも可・降格は人間承認時のみ）`,
    });
  }
  return findings;
}
