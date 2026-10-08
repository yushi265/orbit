import { useEffect } from "react";
import { colorThemeOptions, resolveTheme } from "../../components/theme";
import type { BootstrapViewModel } from "../../shared/view-models";

// テーマ・html lang・ServiceWorker 登録など、document 全体に効く副作用。
export function useDocumentEffects(preferences: BootstrapViewModel["preferences"] | undefined) {
  useEffect(() => {
    if (!preferences || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveTheme(preferences.theme, media.matches);
      const colorTheme =
        colorThemeOptions.find((option) => option.value === preferences.colorTheme) ??
        colorThemeOptions[0];
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.colorTheme = colorTheme.value;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#11151d" : colorTheme.accent);
    };
    applyTheme();
    if (preferences.theme !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [preferences?.theme, preferences?.colorTheme]);

  useEffect(() => {
    if (!preferences || typeof document === "undefined") return;
    // 翻訳が入るまでは日本語UIなので、保存済みlocaleに関わらずjaに固定する。
    document.documentElement.lang = "ja";
  }, [preferences?.locale]);

  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/sw.js?v=4", { updateViaCache: "none" })
        .catch(() => undefined);
  }, []);
}
