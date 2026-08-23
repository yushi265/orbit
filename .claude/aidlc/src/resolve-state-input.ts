// next CLI の入力解決（純 JSON と markdown ラッパー state の両形式を吸収）。
// Phase A の next は純 JSON しか読めず、Phase B の report が生成する markdown ラッパー
// state ファイル（aidlc:state:begin/end マーカー付き）を読めなかった（助言ループが断線）。
// 本関数で両形式を吸収し、空入力・壊れ JSON は生スタックトレースにせず friendly Error にする。

import { parseStateFile } from "./state/state";
import type { WorkflowState } from "./types";

const STATE_MARKER = "<!-- aidlc:state:begin -->";

/**
 * next CLI の生入力（ファイル内容 or stdin）を WorkflowState に解決する。
 * - aidlc:state マーカーを含む → report 生成の state.md とみなし state ブロックを抽出。
 * - それ以外 → 純 JSON（examples/state.example.json 等）として解釈。
 * - 空入力・解釈不能はいずれも原因付き Error（fail-fast・呼び出し側で握って exit 1）。
 */
export function resolveStateInput(raw: string): WorkflowState {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("state 入力が空です。使い方: next <state.json|state.md>、または cat state | next");
  }
  if (raw.includes(STATE_MARKER)) {
    return parseStateFile(raw).state;
  }
  try {
    return JSON.parse(trimmed) as WorkflowState;
  } catch {
    throw new Error("state 入力を JSON として解釈できません（純 JSON か report 生成の state.md を渡してください）");
  }
}
