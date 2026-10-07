import { type ReactNode, useRef } from "react";
import { useDialogBoundary } from "../dialog-boundary";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogBoundary(panelRef, { initialFocus: "[data-modal-autofocus]", onEscape: onClose });

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel generic-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generic-modal-title"
        tabIndex={-1}
      >
        <div className="modal-title">
          <h2 id="generic-modal-title">{title}</h2>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
