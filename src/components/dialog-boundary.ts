import { useEffect, useRef, type RefObject } from "react";

type Entry = { element: HTMLElement; priority: number; initial: () => void };
type Registry = {
  entries: Entry[];
  saved: Map<HTMLElement, { inert: string | null; hidden: string | null }>;
  unlockScroll?: () => void;
};
const registries = new WeakMap<Document, Registry>();
function lockScroll(doc: Document) {
  const win = doc.defaultView;
  const x = win?.scrollX ?? 0;
  const y = win?.scrollY ?? 0;
  const scrollbarWidth =
    doc.documentElement.clientWidth > 0
      ? Math.max(0, (win?.innerWidth ?? 0) - doc.documentElement.clientWidth)
      : 0;
  const saved: Array<{ element: HTMLElement; property: string; value: string; priority: string }> =
    [];
  function set(element: HTMLElement, property: string, value: string) {
    saved.push({
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
    element.style.setProperty(property, value);
  }
  if (scrollbarWidth > 0) {
    const padding = Number.parseFloat(win?.getComputedStyle(doc.body).paddingRight ?? "0") || 0;
    set(doc.body, "padding-right", `${padding + scrollbarWidth}px`);
  }
  set(doc.documentElement, "overflow", "hidden");
  set(doc.body, "overflow", "hidden");
  set(doc.body, "position", "fixed");
  set(doc.body, "top", `${-y}px`);
  set(doc.body, "left", `${-x}px`);
  set(doc.body, "width", "100%");
  return () => {
    for (const { element, property, value, priority } of saved) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    if (x || y) win?.scrollTo(x, y);
  };
}

/** Set the opening caret once, after asynchronous text arrives, unless editing has begun. */
export function useInitialTextCaretEnd(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  ready = true,
) {
  const handled = useRef(false);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const touched = () => {
      handled.current = true;
    };
    const events = ["pointerdown", "keydown", "input", "compositionstart"];
    events.forEach((name) => input.addEventListener(name, touched));
    return () => events.forEach((name) => input.removeEventListener(name, touched));
  }, [ref]);
  useEffect(() => {
    const input = ref.current;
    if (handled.current || !ready || !input) return;
    handled.current = true;
    if (input.ownerDocument.activeElement === input) {
      input.setSelectionRange(value.length, value.length);
    }
  }, [ref, ready, value]);
}

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
    const viewport = doc.defaultView?.visualViewport;
    const syncViewport = () => {
      if (!viewport) return;
      element.style.setProperty("--dialog-viewport-height", `${viewport.height}px`);
      element.style.setProperty("--dialog-viewport-top", `${viewport.offsetTop}px`);
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
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
    if (registry.entries.length === 0) registry.unlockScroll = lockScroll(doc);
    registry.entries.push(entry);
    reconcile(registry);
    if (topEntry(registry) === entry) entry.initial();
    const onKeyDown = (event: KeyboardEvent) => {
      if (topEntry(registry) !== entry) return;
      if (event.key === "Escape") {
        if (event.isComposing || event.keyCode === 229) return;
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
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      element.style.removeProperty("--dialog-viewport-height");
      element.style.removeProperty("--dialog-viewport-top");
      doc.defaultView?.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("focusin", onFocusIn);
      const wasTop = topEntry(registry) === entry;
      registry.entries = registry.entries.filter((item) => item !== entry);
      reconcile(registry);
      if (registry.entries.length === 0) {
        registry.unlockScroll?.();
        registry.unlockScroll = undefined;
      }
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
