export type LinkifiedTextPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

function trimUrlEnd(value: string): string {
  const pairs: Record<string, string> = {
    ")": "(",
    "]": "[",
    "}": "{",
    "）": "（",
    "」": "「",
    "』": "『",
    "】": "【",
  };
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = value.length;
  while (end > 0) {
    const close = value[end - 1];
    if (/[.,!?;:，。！？、；：…]/u.test(close)) {
      end -= 1;
      continue;
    }
    const open = pairs[close];
    if (!open) break;
    const opened = counts.get(open) ?? 0;
    const closed = counts.get(close) ?? 0;
    if (closed <= opened) break;
    counts.set(close, closed - 1);
    end -= 1;
  }
  return value.slice(0, end);
}

export function linkifyText(text: string): LinkifiedTextPart[] {
  const parts: LinkifiedTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`、。，]+/giu)) {
    const candidate = trimUrlEnd(match[0]);
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (match.index > cursor) parts.push({ type: "text", text: text.slice(cursor, match.index) });
    parts.push({ type: "link", text: candidate, href: url.href });
    cursor = match.index + candidate.length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
}
