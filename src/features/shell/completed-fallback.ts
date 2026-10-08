import { useEffect, useState } from "react";
import {
  SHOW_COMPLETED_STORAGE_KEY,
  parseShowCompletedPreference,
} from "../../components/issue-preferences";

// Issues の completed の既定値。localStorage から読み込んで ready にし、以後は表示中の値
// （search の completed、無ければ既定値）を書き戻す。
export function useCompletedFallback(completedFromSearch: boolean | undefined): {
  completedFallback: boolean;
  ready: boolean;
} {
  const [completedFallback, setCompletedFallback] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = parseShowCompletedPreference(
          window.localStorage.getItem(SHOW_COMPLETED_STORAGE_KEY),
        );
        if (stored !== undefined) setCompletedFallback(stored);
      } catch {
        // Ignore storage access failures and keep the default visibility.
      }
    }
    setReady(true);
  }, []);
  // resolveIssueSearch（lib/url-state/issues）の showCompleted と同じ式。Phase 3b-1b で Issues 側に一本化する。
  const showCompleted = completedFromSearch ?? completedFallback;
  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SHOW_COMPLETED_STORAGE_KEY, String(showCompleted));
    } catch {
      // Ignore storage access failures after the preference is applied in memory.
    }
  }, [showCompleted, ready]);
  return { completedFallback, ready };
}
