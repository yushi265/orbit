import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { OrbitIcon } from "./orbit-icon";

describe("OrbitIcon", () => {
  it.each(["settings", "calendar"] as const)(
    "[代表値] %s is drawn without font glyphs and keeps the control label accessible",
    (name) => {
      const markup = renderToStaticMarkup(
        createElement("button", { "aria-label": name }, createElement(OrbitIcon, { name })),
      );
      const dom = new JSDOM(markup);
      const button = dom.window.document.querySelector("button")!;
      const icon = button.querySelector("svg")!;

      expect(button.getAttribute("aria-label")).toBe(name);
      expect(button.textContent).toBe("");
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("focusable")).toBe("false");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
      expect(icon.querySelector("path")).not.toBeNull();
      dom.window.close();
    },
  );
});
