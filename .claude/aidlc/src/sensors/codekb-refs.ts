// codekb-refs sensor: codekb の `参照:` パス切れ検査（advisory）
// codekb（docs/ai-dlc/codekb/）の鮮度規約は「参照: パスの実在確認必須」。書く側の切れを
// 編集時に検出する。判定は純粋関数（existsFn 注入）・fs は dispatch.ts に隔離。fail-open。

export interface CodekbRefFinding {
  line: number; // 1-indexed
  path: string;
}

const REF_PATTERN = /参照:\s*`([^`]+)`/g;

/** codekb 本文から `参照: \`path\`` を全件抽出し、実在しないパスだけ返す */
export function scanCodekbRefs(
  md: string,
  existsFn: (path: string) => boolean,
): CodekbRefFinding[] {
  const findings: CodekbRefFinding[] = [];
  md.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(REF_PATTERN)) {
      const path = m[1].trim();
      if (!existsFn(path)) findings.push({ line: i + 1, path });
    }
  });
  return findings;
}
