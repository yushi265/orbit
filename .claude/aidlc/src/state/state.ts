// AI-DLC 決定論エンジン: 機械可読 state の永続化・遷移・監査（advisory）
// progress.md（人手）と並走する機械可読 state ファイルの parse/serialize と、
// 「1 手の結果（ReportEvent）→ state 遷移 + audit 追記」の純粋関数を提供する。
// 正本: .claude/skills/ai-dlc-flow/SKILL.md（Stage） / .claude/rules/risk-tiers.md（Tier/Gate）
//
// 設計方針:
// - 全 advisory（非強制）。Gate を強制しない・progress.md を除去しない（並走）。hard stop は lefthook/CI/人間。
// - 遷移は純粋関数（副作用なし・immutable）。fs/時刻は CLI（cli.ts）側に隔離してテスト容易性を保つ。

import type { GateId, Tier, WorkflowState } from "../types";

/** 1 手の結果として report される event。state 遷移と audit 追記の単位。 */
export type ReportEvent =
  | { type: "tier-declared"; tier: Tier }
  | { type: "plan-declared"; specPlanned: boolean }
  | { type: "stage-started"; stage: string }
  | { type: "stage-completed"; stage: string }
  | { type: "stage-skipped"; stage: string }
  | { type: "gate-approved"; gate: GateId }
  | { type: "gate-rejected"; gate: GateId }
  // Gate 2 委任: gate2 に narrow し gate1/gate3 の委任をコンパイル時に禁止する。
  // Gate 1 で人間が明示委任した時だけ report する（AI から提案しない）。undelegate はティア再宣言時のリセット・Gate 3 却下・人間の翻意用
  | { type: "gate-delegated"; gate: "gate2" }
  | { type: "gate-undelegated"; gate: "gate2" }
  | { type: "workflow-parked" } // 正規中断（Stop guard が allow 判定に使う）
  | { type: "workflow-unparked" }
  | { type: "note"; note: string }; // 自由記録（`note tokens=<n>` のコスト転記等。state は不変）

/** state ファイル 1 つ分（機械可読 state + 監査ログ）。 */
export interface StateDocument {
  ticket: string;
  state: WorkflowState;
  audit: string[]; // 整形済みの監査行（古い順）
}

const STATE_BEGIN = "<!-- aidlc:state:begin -->";
const STATE_END = "<!-- aidlc:state:end -->";
const AUDIT_HEADING = "## audit log";

/**
 * 1 手の結果を state に適用して**新しい** state を返す（元は破壊しない）。
 * set 演算（同じ event の再適用で同じ結果）なので冪等。
 */
export function applyReport(state: WorkflowState, event: ReportEvent): WorkflowState {
  switch (event.type) {
    case "tier-declared":
      return { ...state, tier: event.tier };
    case "plan-declared":
      return { ...state, specPlanned: event.specPlanned };
    case "stage-started":
      return { ...state, stageStatus: { ...state.stageStatus, [event.stage]: "active" } };
    case "stage-completed":
      return { ...state, stageStatus: { ...state.stageStatus, [event.stage]: "done" } };
    case "stage-skipped":
      return { ...state, stageStatus: { ...state.stageStatus, [event.stage]: "skipped" } };
    case "gate-approved":
      return { ...state, gateStatus: { ...state.gateStatus, [event.gate]: "approved" } };
    case "gate-rejected":
      return { ...state, gateStatus: { ...state.gateStatus, [event.gate]: "pending" } };
    case "gate-delegated":
      return { ...state, gate2Delegated: true };
    case "gate-undelegated":
      return { ...state, gate2Delegated: false };
    case "workflow-parked":
      return { ...state, parked: true };
    case "workflow-unparked":
      return { ...state, parked: false };
    case "note":
      return state; // 記録のみ（audit に残る）。state は不変
  }
}

/** event の「内容シグネチャ」（タイムスタンプ抜き）。audit 行の末尾と一致する。 */
export function eventSignature(event: ReportEvent): string {
  switch (event.type) {
    case "tier-declared":
      return `TIER_DECLARED tier=${event.tier}`;
    case "plan-declared":
      return `PLAN_DECLARED spec=${event.specPlanned}`;
    case "stage-started":
      return `STAGE_STARTED stage=${event.stage}`;
    case "stage-completed":
      return `STAGE_COMPLETED stage=${event.stage}`;
    case "stage-skipped":
      return `STAGE_SKIPPED stage=${event.stage}`;
    case "gate-approved":
      return `GATE_APPROVED gate=${event.gate}`;
    case "gate-rejected":
      return `GATE_REJECTED gate=${event.gate}`;
    case "gate-delegated":
      return `GATE_DELEGATED gate=${event.gate}`;
    case "gate-undelegated":
      return `GATE_UNDELEGATED gate=${event.gate}`;
    case "workflow-parked":
      return "WORKFLOW_PARKED";
    case "workflow-unparked":
      return "WORKFLOW_UNPARKED";
    case "note":
      return `NOTE ${event.note}`;
  }
}

/** 監査行 1 行（`<ISO8601> <SIGNATURE>`）。 */
export function auditLine(event: ReportEvent, timestamp: string): string {
  return `${timestamp} ${eventSignature(event)}`;
}

/** 空の state を持つ新規 document を作る。 */
export function initialDocument(
  ticket: string,
  init: { tier: Tier; specPlanned: boolean },
): StateDocument {
  return {
    ticket,
    state: {
      tier: init.tier,
      specPlanned: init.specPlanned,
      stageStatus: {},
      gateStatus: {},
    },
    audit: [],
  };
}

/**
 * document に event を適用：state を遷移させ、audit に 1 行追記した**新しい** document を返す。
 * idempotency: 直前の audit 行と同一シグネチャなら追記せず skipped=true を返す（二重 report 防止）。
 */
export function applyReportToDocument(
  doc: StateDocument,
  event: ReportEvent,
  timestamp: string,
): { doc: StateDocument; skipped: boolean } {
  const sig = eventSignature(event);
  const last = doc.audit[doc.audit.length - 1];
  if (last && last.endsWith(` ${sig}`)) {
    return { doc, skipped: true }; // 冪等：同じ手を二度報告しても重複追記しない
  }
  return {
    doc: {
      ticket: doc.ticket,
      state: applyReport(doc.state, event),
      audit: [...doc.audit, auditLine(event, timestamp)],
    },
    skipped: false,
  };
}

/** StateDocument を機械可読な markdown へ直列化する。 */
export function serializeStateFile(doc: StateDocument): string {
  const lines = [
    `# aidlc engine state: ${doc.ticket}`,
    "",
    "> 機械可読 state（advisory）。progress.md と並走。`report` 経由で更新し手で編集しない。",
    "",
    STATE_BEGIN,
    JSON.stringify(doc.state, null, 2),
    STATE_END,
    "",
    AUDIT_HEADING,
    ...doc.audit.map((a) => `- ${a}`),
    "",
  ];
  return lines.join("\n");
}

function parseBool(token: string, key: string): boolean {
  const m = token.match(new RegExp(`^${key}=(true|false)$`));
  if (!m) throw new Error(`'${key}=true|false' を期待: '${token}'`);
  return m[1] === "true";
}

function parseGate(token: string | undefined): GateId {
  if (token === "gate1" || token === "gate2" || token === "gate3") return token;
  throw new Error(`不正な gate: '${token}'（gate1|gate2|gate3）`);
}

function requireStage(token: string | undefined): string {
  if (!token) throw new Error("stage id が必要（例: stage-done 3+4）");
  return token;
}

/**
 * CLI 引数（verb + args）を ReportEvent に変換する。不正入力は fail fast で例外。
 * 文法:
 *   tier <1|2|3> | plan spec=<bool>
 *   stage-start <id> | stage-done <id> | stage-skip <id>
 *   gate-approve <gateId> | gate-reject <gateId>
 */
export function parseReportEvent(tokens: string[]): ReportEvent {
  const [verb, ...rest] = tokens;
  switch (verb) {
    case "tier": {
      const n = Number(rest[0]);
      if (n !== 1 && n !== 2 && n !== 3) throw new Error(`不正な tier: '${rest[0]}'（1|2|3）`);
      return { type: "tier-declared", tier: n as Tier };
    }
    case "plan":
      return {
        type: "plan-declared",
        specPlanned: parseBool(rest[0] ?? "", "spec"),
      };
    case "stage-start":
      return { type: "stage-started", stage: requireStage(rest[0]) };
    case "stage-done":
      return { type: "stage-completed", stage: requireStage(rest[0]) };
    case "stage-skip":
      return { type: "stage-skipped", stage: requireStage(rest[0]) };
    case "gate-approve":
      return { type: "gate-approved", gate: parseGate(rest[0]) };
    case "gate-reject":
      return { type: "gate-rejected", gate: parseGate(rest[0]) };
    case "gate-delegate":
    case "gate-undelegate": {
      // 委任できるのは gate2 のみ（gate1/gate3 は不可）。不正入力は fail fast
      if (rest[0] !== "gate2") {
        throw new Error(`委任できるのは gate2 のみ: '${rest[0] ?? ""}'（gate-delegate gate2 / gate-undelegate gate2）`);
      }
      return verb === "gate-delegate"
        ? { type: "gate-delegated", gate: "gate2" }
        : { type: "gate-undelegated", gate: "gate2" };
    }
    case "park":
      return { type: "workflow-parked" };
    case "unpark":
      return { type: "workflow-unparked" };
    case "note": {
      const note = rest.join(" ").trim();
      if (!note) throw new Error("note には本文が必要（例: note tokens=123456）");
      return { type: "note", note };
    }
    default:
      throw new Error(`unknown verb: '${verb}'（tier|plan|stage-start|stage-done|stage-skip|gate-approve|gate-reject|gate-delegate|gate-undelegate|park|unpark|note）`);
  }
}

/**
 * `init` の引数（`tier=N spec=B`）を厳格に解釈する（欠落・不正値は fail fast で例外）。
 * `report ... <event>` 系（parseReportEvent）と検証の厳しさを揃え、サイレントフォールバックを禁止する。
 */
export function parseInitArgs(tokens: string[]): { tier: Tier; specPlanned: boolean } {
  const find = (key: string): string => {
    const t = tokens.find((x) => x.startsWith(`${key}=`));
    if (!t) throw new Error(`init には '${key}=...' が必要`);
    return t;
  };
  const tierTok = find("tier");
  const tierN = Number(tierTok.slice("tier=".length));
  if (tierN !== 1 && tierN !== 2 && tierN !== 3) throw new Error(`不正な tier: '${tierTok}'（tier=1|2|3）`);
  return {
    tier: tierN as Tier,
    specPlanned: parseBool(find("spec"), "spec"),
  };
}

/** 機械可読 markdown から StateDocument を復元する。 */
export function parseStateFile(md: string): StateDocument {
  const begin = md.indexOf(STATE_BEGIN);
  const end = md.indexOf(STATE_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("state ブロック（aidlc:state:begin/end）が見つからない");
  }
  const json = md.slice(begin + STATE_BEGIN.length, end).trim();
  const state = JSON.parse(json) as WorkflowState;

  const titleMatch = md.match(/^#\s+aidlc engine state:\s*(.+?)\s*$/m);
  const ticket = titleMatch ? titleMatch[1] : "";

  const auditIdx = md.indexOf(AUDIT_HEADING);
  const audit: string[] =
    auditIdx === -1
      ? []
      : md
          .slice(auditIdx + AUDIT_HEADING.length)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2).trim());

  return { ticket, state, audit };
}
