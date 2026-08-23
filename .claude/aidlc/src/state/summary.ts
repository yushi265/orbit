// report summary: audit 行の機械集計（コストレポート）
// Stage 消化数 / gate 往復数 / トークン転記値を **LLM に数えさせず**決定論で集計する
// Gate 3 の成果提示に添付する審査材料。

export interface AuditSummary {
  events: number; // 解釈できた audit 行数
  stagesCompleted: number;
  stagesSkipped: number;
  gatesApproved: number;
  gateRejections: number; // gate 往復数（差し戻し回数）
  tokens: number | null; // NOTE tokens=<n> の最後の値（未転記は null）
}

/** audit 行（`<ISO8601> <SIGNATURE>`）を集計する。解釈できない行は skip（fail-open） */
export function summarizeAudit(audit: string[]): AuditSummary {
  const s: AuditSummary = {
    events: 0,
    stagesCompleted: 0,
    stagesSkipped: 0,
    gatesApproved: 0,
    gateRejections: 0,
    tokens: null,
  };
  for (const line of audit) {
    const m = line.match(/^\S+\s+([A-Z_]+)(?:\s+(.*))?$/);
    if (!m) continue;
    s.events++;
    const [, signature, rest] = m;
    switch (signature) {
      case "STAGE_COMPLETED":
        s.stagesCompleted++;
        break;
      case "STAGE_SKIPPED":
        s.stagesSkipped++;
        break;
      case "GATE_APPROVED":
        s.gatesApproved++;
        break;
      case "GATE_REJECTED":
        s.gateRejections++;
        break;
      case "NOTE": {
        const t = rest?.match(/tokens=(\d+)/);
        if (t) s.tokens = Number(t[1]);
        break;
      }
    }
  }
  return s;
}

/** Gate 3 添付用の表を整形する */
export function formatSummary(ticket: string, s: AuditSummary): string {
  return [
    `[aidlc summary] ${ticket}（audit ${s.events} イベント）`,
    "| 指標 | 値 |",
    "|---|---|",
    `| Stage 消化 | ${s.stagesCompleted}（skip ${s.stagesSkipped}） |`,
    `| gate 承認 | ${s.gatesApproved} |`,
    `| gate 差し戻し（往復） | ${s.gateRejections} |`,
    `| トークン転記 | ${s.tokens ?? "記録なし（report <state> note tokens=<n> で転記）"} |`,
  ].join("\n");
}
