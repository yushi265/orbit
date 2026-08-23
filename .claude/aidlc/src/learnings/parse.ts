// learnings: retro note の構造化パース + 集約（surface）
// 現行 retro note フォーマット（docs/ai-dlc/retro/_TEMPLATE.md）を機械パースし、
// retro-triage の「未対応 Try 集約」「カテゴリ再発チェック」を機械化する純粋関数。
// 正本: docs/ai-dlc/retro/README.md（書き方・カテゴリ・還流先・ステータス値）。

export interface ProblemItem {
  category: string; // spec / tdd / review / gate / boundary / security / tooling / other
  text: string;
}

export interface ActionItem {
  improvement: string; // 「Try」列
  refluxTarget: string; // 「還流先」列
  status: string; // 「ステータス」列（未対応 / Issue化 / 反映済み(PR#) / 見送り(理由)）
}

export interface StageInsight {
  stage: string;
  note: string;
}

export interface ParsedRetroNote {
  ticket: string | null;
  problems: ProblemItem[];
  actions: ActionItem[];
  insights: StageInsight[];
  /** 気づきセルに埋め込まれた `[category]` タグ（一部 note は Problem でなく気づきに分類タグを書く） */
  insightTags: string[];
  /** メタの「着手日 / 完了日」由来の note 日付（完了日優先・無ければ null。measure の期間バケット割当に使う） */
  completedDate: string | null;
  /** タグ無し Problem 行（measure が other として集計・落とさない。既存 problems / surface 集計は不変） */
  untaggedProblems: string[];
}

export interface Aggregation {
  /** 全 note 横断の status=未対応 アクション（triage の「未対応 Try 集約」・重複除去済み） */
  openActions: ActionItem[];
  /** カテゴリ別の出現回数（Problem + 気づきタグ。再発＝効果測定のキー） */
  categoryCounts: Record<string, number>;
  /** カテゴリ別 Problem 一覧 */
  problemsByCategory: Record<string, ProblemItem[]>;
}

type Section = "" | "meta" | "insights" | "problem" | "actions";

const TICKET = /^-\s*ticket:\s*(.+)$/;
const DATES = /^-\s*着手日\s*\/\s*完了日:\s*(\S+)\s*\/\s*(\S+)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROBLEM = /^-\s+`\[([a-z]+)\]`\s*(.+)$/;
const CATEGORY_TAG = /`\[([a-z]+)\]`/g;
const STATUS_OPEN = "未対応";

/** `| a | b | c |` 形式の行をセル配列に。表でなければ null */
function tableCells(line: string): string[] | null {
  if (!line.startsWith("|")) return null;
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** markdown テーブルの区切り行（|---|---| 等。-, :, |, 空白のみで - を含む） */
function isSeparatorRow(line: string): boolean {
  return line.startsWith("|") && line.includes("-") && /^[\s|:-]+$/.test(line);
}

/** テンプレ未記入のプレースホルダ（<...> / <あれば> / 空） */
function isPlaceholder(s: string): boolean {
  const t = s.trim();
  return t === "" || /^<.*>$/.test(t);
}

/** retro note の markdown を構造化して返す（副作用なし） */
export function parseRetroNote(md: string): ParsedRetroNote {
  const result: ParsedRetroNote = {
    ticket: null,
    problems: [],
    actions: [],
    insights: [],
    insightTags: [],
    completedDate: null,
    untaggedProblems: [],
  };
  const lines = md.split(/\r?\n/);
  let section: Section = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("## ") || line.startsWith("### ")) {
      if (line.includes("メタ")) section = "meta";
      else if (line.includes("気づき")) section = "insights";
      else if (line.includes("Problem")) section = "problem";
      else if (line.includes("フロー改善アクション")) section = "actions";
      else section = ""; // Keep / Try / 振り返り 見出し等は Phase A の対象外
      continue;
    }

    if (section === "meta") {
      const m = line.match(TICKET);
      if (m) result.ticket = m[1].trim();
      const d = line.match(DATES);
      if (d) {
        // 完了日優先・プレースホルダなら着手日へフォールバック・両方不正なら null のまま
        if (ISO_DATE.test(d[2])) result.completedDate = d[2];
        else if (ISO_DATE.test(d[1])) result.completedDate = d[1];
      }
      continue;
    }

    if (section === "problem") {
      const m = line.match(PROBLEM);
      if (m) result.problems.push({ category: m[1], text: m[2].trim() });
      else if (line.startsWith("- ")) {
        // タグ無し Problem 行も落とさない（measure が other に集計。プレースホルダは除外）
        const text = line.slice(2).trim();
        if (!isPlaceholder(text)) result.untaggedProblems.push(text);
      }
      continue;
    }

    if (section === "insights" || section === "actions") {
      if (isSeparatorRow(line)) continue;
      const cells = tableCells(line);
      if (!cells) continue;
      // ヘッダ行 = 次行が区切り行（| Stage |…| / | 工程 |…| / | Try |…| を見出し名に依存せず判定）
      const nextIsSeparator = i + 1 < lines.length && isSeparatorRow(lines[i + 1].trim());
      if (nextIsSeparator) continue;

      if (section === "insights") {
        if (cells.length >= 2 && !isPlaceholder(cells[1])) {
          result.insights.push({ stage: cells[0], note: cells[1] });
        }
        // 気づきセル内に埋め込まれた `[category]` タグも拾う
        for (const m of line.matchAll(CATEGORY_TAG)) result.insightTags.push(m[1]);
      } else {
        if (cells.length >= 3 && !isPlaceholder(cells[0])) {
          result.actions.push({ improvement: cells[0], refluxTarget: cells[1], status: cells[2] });
        }
      }
    }
  }

  return result;
}

/** 複数 note を横断集約（未対応 Try 集約・重複除去・カテゴリ再発カウント） */
export function aggregateLearnings(notes: ParsedRetroNote[]): Aggregation {
  const agg: Aggregation = { openActions: [], categoryCounts: {}, problemsByCategory: {} };
  const seen = new Set<string>();
  const bump = (category: string) => {
    agg.categoryCounts[category] = (agg.categoryCounts[category] ?? 0) + 1;
  };

  for (const note of notes) {
    for (const a of note.actions) {
      if (a.status.trim() !== STATUS_OPEN) continue; // 完全一致（「見送り(未対応…)」等の誤計上を防ぐ）
      const key = `${a.improvement}\u0000${a.refluxTarget}`;
      if (seen.has(key)) continue; // 同一 Try の重複除去
      seen.add(key);
      agg.openActions.push(a);
    }
    for (const p of note.problems) {
      bump(p.category);
      (agg.problemsByCategory[p.category] ??= []).push(p);
    }
    for (const cat of note.insightTags) bump(cat);
  }

  return agg;
}
