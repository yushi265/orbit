import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
};

// PWA のインストール。結果の通知（Toast）は呼び出し側が onResult で行う。
export function usePwaInstall(onResult: (result: "installed" | "failed") => void): {
  canInstall: boolean;
  install: () => Promise<void>;
} {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);
  async function install() {
    if (!installPrompt) return;
    try {
      const result = await installPrompt.prompt();
      if (result.outcome === "accepted") onResult("installed");
    } catch {
      onResult("failed");
    } finally {
      setInstallPrompt(null);
    }
  }
  return { canInstall: installPrompt !== null, install };
}
