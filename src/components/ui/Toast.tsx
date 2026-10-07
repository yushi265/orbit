import { useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; onClick: () => void };

export type ToastState = {
  kind: "success" | "error";
  text: string;
  action?: ToastAction;
};

const TOAST_AUTO_DISMISS_MS = 3500;

/** 自動で消えるのは、アクションなしの成功トーストだけ。 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const clearTimer = () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };
  useEffect(() => clearTimer, []);
  const dismissToast = () => {
    clearTimer();
    setToast(null);
  };
  const showToast = (kind: ToastState["kind"], text: string, action?: ToastAction) => {
    clearTimer();
    setToast({ kind, text, action });
    if (kind === "success" && !action)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        setToast(null);
      }, TOAST_AUTO_DISMISS_MS);
  };
  return { toast, showToast, dismissToast };
}

/** ライブリージョンは常に DOM に置く（後から挿入された領域は読み上げられないため）。 */
export function ToastRegion({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
}) {
  const body = toast && (
    <div className={`toast ${toast.kind}`}>
      <span aria-hidden="true">{toast.kind === "success" ? "✓" : "!"}</span>
      {toast.text}
      {toast.action && (
        <button className="text-button" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      {(toast.kind === "error" || toast.action) && (
        <button
          className="icon-button toast-close"
          type="button"
          aria-label="通知を閉じる"
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  );
  return (
    <>
      <div role="status">{toast?.kind === "success" ? body : null}</div>
      <div role="alert">{toast?.kind === "error" ? body : null}</div>
    </>
  );
}
