// return check: サブエージェント返答の受領検査（advisory）
// 必須見出しの存在と自己矛盾（GREEN 主張 × RED 証跡なし等）を機械検査する。
// 「中身の薄さ」（本文が空）は警告のみ——質の判定は reviewer / referee の担当（守備範囲を守る）。
// 過去事故: malformed 出力の素通り（learnings.md 2026-06-25）の再発防止。
// 正本: 各エージェント .md の「出力」節。ミラー: return-schemas.json（drift 検査への追加は将来拡張・現状は check.test.ts の較正テストが読める事を担保）。

export interface ReturnSchema {
  /** 必須見出し（行頭一致・後続文字は許容） */
  required: string[];
  /** `if` 見出しが存在するなら `requires` 見出しも必須（自己矛盾の検知） */
  contradictions?: { if: string; requires: string }[];
}

export type ReturnSchemas = Record<string, ReturnSchema>;

export interface ReturnCheckResult {
  ok: boolean;
  missing: string[];
  contradictions: string[];
  /** 見出しはあるが本文が空（警告・fail にしない） */
  emptyWarnings: string[];
}

function headingIndex(lines: string[], heading: string): number {
  return lines.findIndex((l) => l.trim().startsWith(heading));
}

function hasBody(lines: string[], from: number): boolean {
  for (let i = from + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("## ")) return false; // 次の見出しに到達
    if (t !== "") return true;
  }
  return false;
}

export function checkReturn(text: string, schema: ReturnSchema): ReturnCheckResult {
  const lines = text.split("\n");
  const missing: string[] = [];
  const emptyWarnings: string[] = [];

  for (const heading of schema.required) {
    const idx = headingIndex(lines, heading);
    if (idx === -1) {
      missing.push(heading);
    } else if (!hasBody(lines, idx)) {
      emptyWarnings.push(`${heading} の本文が空（中身の検証は reviewer/referee 担当）`);
    }
  }

  const contradictions: string[] = [];
  for (const rule of schema.contradictions ?? []) {
    if (headingIndex(lines, rule.if) !== -1 && headingIndex(lines, rule.requires) === -1) {
      contradictions.push(
        `${rule.if} があるのに ${rule.requires} が無い（自己矛盾: 証跡の欠落）`,
      );
    }
  }

  return { ok: missing.length === 0 && contradictions.length === 0, missing, contradictions, emptyWarnings };
}
