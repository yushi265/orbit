import { useEffect, useRef } from "react";

export function useKeyboardReorderFocus(busy: boolean) {
  const handleRef = useRef<HTMLButtonElement>(null);
  const keyboardIntentRef = useRef(false);
  const pendingSeenRef = useRef(false);
  const stopMonitoringRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopMonitoringRef.current?.(), []);
  useEffect(() => {
    if (busy) {
      if (keyboardIntentRef.current) pendingSeenRef.current = true;
      return;
    }
    if (!pendingSeenRef.current) return;
    pendingSeenRef.current = false;
    stopMonitoringRef.current?.();
    stopMonitoringRef.current = null;
    const restore = keyboardIntentRef.current;
    keyboardIntentRef.current = false;
    const handle = handleRef.current;
    if (!restore || !handle?.isConnected || handle.disabled || handle.closest("[inert]")) return;
    const active = handle.ownerDocument.activeElement;
    if (active === handle.ownerDocument.body || active === handle)
      handle.focus({ preventScroll: true });
  }, [busy]);
  return {
    handleRef,
    rememberKeyboardFocus: () => {
      stopMonitoringRef.current?.();
      stopMonitoringRef.current = null;
      const handle = handleRef.current;
      keyboardIntentRef.current = !!handle && handle.ownerDocument.activeElement === handle;
      pendingSeenRef.current = false;
      if (!keyboardIntentRef.current || !handle) return;
      const doc = handle.ownerDocument;
      const onFocusIn = (event: FocusEvent) => {
        if (event.target === handle || event.target === doc.body) return;
        keyboardIntentRef.current = false;
        stopMonitoringRef.current?.();
        stopMonitoringRef.current = null;
      };
      const onDragStart = () => {
        keyboardIntentRef.current = false;
        pendingSeenRef.current = false;
        stopMonitoringRef.current?.();
        stopMonitoringRef.current = null;
      };
      doc.addEventListener("focusin", onFocusIn);
      doc.addEventListener("dragstart", onDragStart, true);
      stopMonitoringRef.current = () => {
        doc.removeEventListener("focusin", onFocusIn);
        doc.removeEventListener("dragstart", onDragStart, true);
      };
    },
  };
}
