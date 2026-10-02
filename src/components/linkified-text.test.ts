import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { LinkifiedText } from "./LinkifiedText";
import { linkifyText } from "./linkified-text";

function render(text: string, className?: string) {
  const dom = new JSDOM(renderToStaticMarkup(createElement(LinkifiedText, { text, className })));
  return dom.window.document;
}

describe("LinkifiedText", () => {
  it("[代表値] http/httpsのURLだけを別タブの安全なリンクにする", () => {
    const text = "参照 https://example.com/docs\nhttp://example.org/確認";
    const document = render(text, "description-text");
    const links = [...document.querySelectorAll("a")];
    expect(document.body.textContent).toBe(text);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/docs",
      "http://example.org/%E7%A2%BA%E8%AA%8D",
    ]);
    expect(
      links.every((link) => link.target === "_blank" && link.rel === "noopener noreferrer"),
    ).toBe(true);
    expect(document.querySelector(".description-text")?.getAttribute("style")).toContain(
      "white-space:pre-wrap",
    );
  });

  it("[境界値] 日本語の句読点とURL末尾の英文句読点はリンクに含めない", () => {
    const text = "資料 https://example.com/docs。次に https://example.org/path, を確認。";
    const document = render(text);
    expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/docs",
      "https://example.org/path",
    ]);
    expect(document.body.textContent).toBe(text);
  });

  it("[境界値] 文中の括弧を取り除きURL内のbalanced括弧は維持する", () => {
    const text =
      "(https://example.com/a(foo)). https://example.org/(a_(b)) https://example.net/docs)";
    const document = render(text);
    expect([...document.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "https://example.com/a(foo)",
      "https://example.org/(a_(b))",
      "https://example.net/docs",
    ]);
    expect(document.body.textContent).toBe(text);
  });

  it("[セキュリティ] HTML・javascript・data・属性注入文字列を実行可能な要素にしない", () => {
    const text =
      '<img src=x onerror=alert(1)><script>alert(1)</script><svg onload=alert(1)>\njavascript:alert(1) data:text/html,<b>危険</b> ftp://example.com\nhttps://example.com/" onclick="alert(1)';
    const document = render(text);
    expect(document.body.textContent).toBe(text);
    expect(document.querySelector("img,script,svg,b,[onclick],[onerror],[onload]")).toBeNull();
    const links = [...document.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com/");
    expect(links[0].getAttribute("onclick")).toBeNull();
  });

  it("[同値分割] 不正URL・http以外・空文字列はtextのまま維持する", () => {
    const text =
      "https:// http://[invalid] javascript:alert(1) data:text/plain,例 ftp://example.com";
    const document = render(text);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(document.body.textContent).toBe(text);
    expect(render("").body.textContent).toBe("");
  });

  it("[代表値] 日本語URLのラベルと改行を保持しhrefはURLで正規化する", () => {
    const text = "日本語\nhttps://例え.テスト/経路?検索=猫\r\n確認 HTTP://EXAMPLE.COM/path#part";
    const document = render(text);
    const links = [...document.querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "https://例え.テスト/経路?検索=猫",
      "HTTP://EXAMPLE.COM/path#part",
    ]);
    expect(links[0].getAttribute("href")).toBe(
      "https://xn--r8jz45g.xn--zckzah/%E7%B5%8C%E8%B7%AF?%E6%A4%9C%E7%B4%A2=%E7%8C%AB",
    );
    expect(links[1].getAttribute("href")).toBe("http://example.com/path#part");
    expect(document.body.textContent).toBe(text.replace("\r\n", "\n"));
    expect(
      linkifyText(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  it("[境界値] 日本語の括弧・連続URL・IPv6 hostnameを正しく区切る", () => {
    const text =
      "「https://example.com/（概要）」 https://a.example、https://b.example。 http://[::1]:3000/";
    const document = render(text);
    expect([...document.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
      "https://example.com/（概要）",
      "https://a.example",
      "https://b.example",
      "http://[::1]:3000/",
    ]);
    expect(document.body.textContent).toBe(text);
    expect(
      linkifyText(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });
});
