import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Rule = { selectors: string[]; decls: Map<string, string> };

// at-rule (@media 等) の中身は読み飛ばし、トップレベルのルールだけを順序つきで取り出す。
function topLevelRules(source: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open < 0) break;
    const prelude = source.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      j++;
    }
    const body = source.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith("@")) continue;
    const decls = new Map<string, string>();
    for (const part of body.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    rules.push({ selectors: prelude.split(",").map((s) => s.trim()), decls });
  }
  return rules;
}

const rules = topLevelRules(css);

function lastDecl(selector: string, prop: string, theme = ""): string | undefined {
  let found: string | undefined;
  for (const rule of rules) {
    if (rule.selectors.includes(selector) && rule.decls.has(prop)) found = rule.decls.get(prop);
  }
  void theme;
  return found;
}

function cssVar(name: string, scope = ":root"): string {
  const value = lastDecl(scope, name);
  if (!value) throw new Error(`${name} is not defined in ${scope}`);
  return value;
}

function resolveVars(value: string, scope = ":root"): string {
  return value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_m, name: string, fb?: string) => {
    const defined =
      lastDecl(scope, name) ?? (scope === ":root" ? undefined : lastDecl(":root", name));
    return resolveVars(defined ?? fb ?? "", scope);
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not an opaque hex color: ${hex}`);
  return [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_BGS = ["#ffffff", "#fbfcfd", "#f7f8fa"];
const THEMES = ["coral", "ocean", "violet", "forest", "amber"] as const;
const themeScope = (t: string) => (t === "coral" ? ":root" : `:root[data-color-theme="${t}"]`);
const themeVar = (t: string, name: string) => {
  const own = lastDecl(themeScope(t), name);
  return own ?? cssVar(name);
};

describe("AC-8 ライトテーマの補助テキスト色", () => {
  it("[境界値] --orbit-muted が白・#fbfcfd・#f7f8fa に対して 4.5:1 以上", () => {
    const muted = resolveVars(cssVar("--orbit-muted"));
    for (const bg of LIGHT_BGS) expect(contrast(muted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("[境界値] placeholder の色が 4.5:1 以上", () => {
    const value = lastDecl("::placeholder", "color") ?? lastDecl("input::placeholder", "color");
    expect(value, "placeholder color rule").toBeDefined();
    const color = resolveVars(value!);
    for (const bg of LIGHT_BGS) expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
  });

  const audited = [
    ".nav-label",
    ".eyebrow",
    ".issue-id",
    ".table-header",
    ".issue-description",
    ".project-cell",
    ".due-cell",
    ".subheading",
    ".metric-foot",
    ".nav-item",
    ".cycle-tabs button",
    "kbd",
    ".setting-row div span",
  ];
  it.each(audited)("[境界値] %s のライトテーマ文字色が 4.5:1 以上", (selector) => {
    const value = lastDecl(selector, "color");
    expect(value, `${selector} color`).toBeDefined();
    const color = resolveVars(value!);
    for (const bg of LIGHT_BGS) expect(contrast(color, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("[境界値] ダークテーマの --orbit-muted は #19202b・#202938 上で 4.5:1 以上", () => {
    const muted = cssVar("--orbit-muted", ':root[data-theme="dark"]');
    for (const bg of ["#19202b", "#202938", "#11151d"])
      expect(contrast(muted, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("AC-9 アクセント色", () => {
  it.each(THEMES)(
    "[境界値] %s の --orbit-accent-solid は白文字・soft 上の文字として 4.5:1 以上",
    (t) => {
      const solid = themeVar(t, "--orbit-accent-solid");
      const soft = themeVar(t, "--orbit-accent-soft");
      expect(contrast(solid, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(solid, soft)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("[代表値] .button.primary・.brand-mark・.mobile-create の背景が --orbit-accent-solid を参照する", () => {
    const rule = rules.find(
      (r) =>
        r.selectors.includes(".brand-mark") &&
        r.selectors.includes(".button.primary") &&
        r.selectors.includes(".mobile-create") &&
        r.decls.get("background")?.includes("--orbit-accent-solid"),
    );
    expect(rule).toBeDefined();
  });

  it("[代表値] アクティブなナビ項目・.text-button の文字色が --orbit-accent-solid を参照する", () => {
    expect(lastDecl(".nav-item.active", "color")).toContain("--orbit-accent-solid");
    expect(lastDecl(":root[data-color-theme] .text-button", "color")).toContain(
      "--orbit-accent-solid",
    );
  });

  it("[境界値] ダークテーマのアクティブなナビ項目の文字色は背景に対して 4.5:1 以上", () => {
    const fg = lastDecl(':root[data-theme="dark"] .nav-item.active', "color")!;
    const bg = lastDecl(':root[data-theme="dark"] .nav-item.active', "background")!;
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("AC-10 フォーカス表示", () => {
  it("[境界値] --orbit-focus がライトで #fff・#f7f8fa に 3:1 以上、ダークで #19202b に 3:1 以上", () => {
    const light = cssVar("--orbit-focus");
    const dark = cssVar("--orbit-focus", ':root[data-theme="dark"]');
    for (const bg of ["#ffffff", "#f7f8fa"]) expect(contrast(light, bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(dark, "#19202b")).toBeGreaterThanOrEqual(3);
  });

  it("[代表値] :focus-visible の outline が --orbit-focus を参照し、色に透明度が無い", () => {
    const outline = lastDecl(":focus-visible", "outline")!;
    expect(outline).toContain("var(--orbit-focus)");
    expect(outline).not.toMatch(/rgba|hsla|\//);
    expect(() => hexToRgb(cssVar("--orbit-focus"))).not.toThrow();
    expect(() => hexToRgb(cssVar("--orbit-focus", ':root[data-theme="dark"]'))).not.toThrow();
  });

  it.each([".inline-search", ".search-hero", ".command-input"])(
    "[代表値] %s に :focus-within のフォーカス表示がある",
    (sel) => {
      const decl = lastDecl(`${sel}:focus-within`, "outline");
      expect(decl, `${sel}:focus-within outline`).toContain("var(--orbit-focus)");
    },
  );

  it("[代表値] .orbit-calendar-trigger:focus-visible に outline がある", () => {
    const decl = lastDecl(".orbit-calendar-trigger:focus-visible", "outline");
    expect(decl).toContain("var(--orbit-focus)");
  });
});

describe("AC-12 並び替えボタン", () => {
  it("[代表値] デスクトップ幅の .touch-move-button は display: none ではなく 24x24px 以上", () => {
    const rule = rules.find((r) => r.selectors.includes(".touch-move-button"))!;
    expect(rule.decls.get("display")).not.toBe("none");
    expect(parseInt(rule.decls.get("min-width") ?? "0", 10)).toBeGreaterThanOrEqual(24);
    expect(parseInt(rule.decls.get("min-height") ?? "0", 10)).toBeGreaterThanOrEqual(24);
  });
});
