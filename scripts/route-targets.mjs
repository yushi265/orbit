// ルーター遷移の `to` が型検査を受けることをリポジトリ検査で担保する（REFACTOR-ui-architecture AC-5）。
// router の型は `string` 型の値を素通しするため、cast が無くても変数・テンプレートリテラル・連結は検査を受けない。
// 許可するのは文字列リテラルと型付きの対応表 `NAV_PATHS[…]` だけ。`as never` はどこにあっても不合格。
// 対象: `navigate({…})` / `redirect({…})` の引数内の `to:`、`<Link>` / `<Navigate>` の `to=`。
// 対象外: オプションを変数で渡す呼び出し（`navigate(options)`）と `router.history.push`（本番コードに無い）。

const CALL = /\b(?:navigate|redirect)\(\s*\{/g;
const TO_KEY = /\bto:\s*([^,\n]+)/g;
const ELEMENT_TO =
  /<(?:Link|Navigate)\b(?:(?!<\/?[A-Za-z])[\s\S]){0,400}?\bto=(\{[^}]*\}|"[^"]*")/g;
// 値の先頭がリテラルか NAV_PATHS[…] で、その直後が区切り（, } ) 行末）であること
const ALLOWED = /^(?:"[^"`]*"|'[^'`]*'|NAV_PATHS\[[^\]]+\])(?=\s*(?:[,})]|$))/;

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function isAllowed(value) {
  const inner = value.startsWith("{") ? value.slice(1).trim() : value;
  return ALLOWED.test(inner);
}

// `(` の位置から対応する `)` までを返す（文字列リテラル内の括弧は数えない）
function callArguments(source, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && (depth -= 1) === 0) return source.slice(open, index + 1);
  }
  return source.slice(open);
}

export function findRouteTargetViolations(source) {
  const violations = [];
  for (const call of source.matchAll(CALL)) {
    const open = call.index + call[0].indexOf("(");
    const args = callArguments(source, open);
    for (const match of args.matchAll(TO_KEY)) {
      const value = match[1].trim();
      if (!isAllowed(value)) violations.push(`${lineOf(source, open + match.index)}: to: ${value}`);
    }
  }
  for (const match of source.matchAll(ELEMENT_TO)) {
    const value = match[1].trim();
    if (!isAllowed(value))
      violations.push(`${lineOf(source, match.index + match[0].lastIndexOf("to="))}: to=${value}`);
  }
  source.split("\n").forEach((line, index) => {
    if (/\bas never\b/.test(line)) violations.push(`${index + 1}: as never`);
  });
  return violations.sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
}
