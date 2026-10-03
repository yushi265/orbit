import { useEffect, useRef, type RefObject } from "react";

type Entry = { element: HTMLElement; priority: number; initial: () => void };
type Registry = {
  entries: Entry[];
  saved: Map<HTMLElement, { inert: string | null; hidden: string | null }>;
};
const registries = new WeakMap<Document, Registry>();
function topEntry(registry: Registry) {
  return registry.entries.reduce<Entry | undefined>(
    (top, entry) => (!top || entry.priority >= top.priority ? entry : top),
    undefined,
  );
}
function reconcile(registry: Registry) {
  for (const [element, original] of registry.saved) {
    if (original.inert === null) element.removeAttribute("inert");
    else element.setAttribute("inert", original.inert);
    if (original.hidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", original.hidden);
  }
  registry.saved.clear();
  let branch = topEntry(registry)?.element;
  while (branch && branch !== branch.ownerDocument.body) {
    const parent = branch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      registry.saved.set(sibling, {
        inert: sibling.getAttribute("inert"),
        hidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = parent;
  }
}
function focusables(element: HTMLElement) {
  return [
    ...element.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]",
    ),
  ].filter((item) => {
    if (item.tabIndex < 0 || item.closest("[hidden], [inert]")) return false;
    const style = item.ownerDocument.defaultView?.getComputedStyle(item);
    return style?.display !== "none" && style?.visibility !== "hidden";
  });
}

/** Owns Focus and inert for the top Dialog, including nested modals and a running Run. */
export function useDialogBoundary(
  ref: RefObject<HTMLElement | null>,
  options: { onEscape: () => void; initialFocus?: string; enabled?: boolean; priority?: number },
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const previousRef = useRef(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const doc = element.ownerDocument;
    const registry: Registry = registries.get(doc) ?? { entries: [], saved: new Map() };
    registries.set(doc, registry);
    const entry: Entry = {
      element,
      priority: optionsRef.current.priority ?? 0,
      initial: () => {
        const target = optionsRef.current.initialFocus
          ? element.querySelector<HTMLElement>(optionsRef.current.initialFocus)
          : null;
        const initial =
          target && !target.hasAttribute("disabled") && !target.closest("[hidden], [inert]")
            ? target
            : null;
        (initial ?? focusables(element)[0] ?? element).focus({ preventScroll: true });
      },
    };
    registry.entries.push(entry);
    reconcile(registry);
    if (topEntry(registry) === entry) entry.initial();
    const onKeyDown = (event: KeyboardEvent) => {
      if (topEntry(registry) !== entry) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        optionsRef.current.onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(element);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        element.focus({ preventScroll: true });
      } else if (
        event.shiftKey &&
        (doc.activeElement === first ||
          doc.activeElement === element ||
          !element.contains(doc.activeElement))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (doc.activeElement === last || !element.contains(doc.activeElement))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
      event.stopPropagation();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (topEntry(registry) === entry && !element.contains(event.target as Node)) entry.initial();
    };
    // Native keys reach Window before Document; direct Window dispatches have no
    // Document phase. The same capture handler stops propagation after handling
    // a key, so the fallback Document listener cannot dispatch it twice.
    doc.defaultView?.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("focusin", onFocusIn);
    return () => {
      doc.defaultView?.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("focusin", onFocusIn);
      const wasTop = topEntry(registry) === entry;
      registry.entries = registry.entries.filter((item) => item !== entry);
      reconcile(registry);
      if (!wasTop) return;
      const previous = previousRef.current;
      const top = topEntry(registry);
      if (
        previous?.isConnected &&
        !previous.closest("[inert]") &&
        (!top || top.element.contains(previous))
      ) {
        previous.focus({ preventScroll: true });
      } else top?.initial();
    };
  }, [enabled, ref]);
}
