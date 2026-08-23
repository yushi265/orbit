// task ledger: progress.md の実装タスク計画のパース（advisory）
// 台帳記法（1 行形式）だけを厳密にパースし、マッチしない行は自由記述として無視する
// （progress.md の気軽さを壊さない）。判定は verify.ts・fs/CLI は cli.ts。

export interface LedgerTask {
  done: boolean;
  id: string; // T1, T2, ...
  layer: string; // プロジェクトが定義するレイヤー名（例: data / service / ui / infra）。任意の小文字識別子を受容
  acs: string[]; // ["AC-1"] / 横断タスク（なし）は []
  deps: string[]; // ["T1"] / 依存なしは []
  title: string;
}

// 記法: `- [x] T2 [service] AC-2,AC-3 依存:T1 — タイトル`
// レイヤー名はスタック非依存（任意の小文字識別子・ハイフン可）。プロジェクトのレイヤー集合に合わせて使う。
const LEDGER_LINE =
  /^- \[([ x])\] (T\d+) \[([a-z][a-z0-9-]*)\] (なし|AC-\d+(?:,AC-\d+)*) 依存:(なし|T\d+(?:,T\d+)*) — (.+)$/;

/** progress.md 全文から台帳行だけを構造化する（記法外の行は無視） */
export function parseLedger(md: string): LedgerTask[] {
  const tasks: LedgerTask[] = [];
  for (const line of md.split("\n")) {
    const m = line.trim().match(LEDGER_LINE);
    if (!m) continue;
    const [, mark, id, layer, acPart, depPart, title] = m;
    tasks.push({
      done: mark === "x",
      id,
      layer,
      acs: acPart === "なし" ? [] : acPart.split(","),
      deps: depPart === "なし" ? [] : depPart.split(","),
      title: title.trim(),
    });
  }
  return tasks;
}

/** spec（index.md）から AC 番号をユニーク抽出する（出現順） */
export function extractSpecAcs(md: string): string[] {
  const seen = new Set<string>();
  for (const m of md.matchAll(/AC-\d+/g)) seen.add(m[0]);
  return [...seen];
}
