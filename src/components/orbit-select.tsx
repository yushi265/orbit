import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type OrbitSelectOption = { value: string; label: string };

export function OrbitSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: OrbitSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState({ left: 8, top: 8, width: 220, maxHeight: 320 });
  const selectedIndex = options.findIndex((option) => option.value === value);

  function updatePlacement() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.min(Math.max(rect.width, 220), Math.max(0, viewportWidth - 16));
    const below = viewportTop + viewportHeight - rect.bottom - 14;
    const above = rect.top - viewportTop - 14;
    const desiredHeight = Math.min(options.length * 44 + 10, 320);
    const placeBelow = below >= desiredHeight || below >= above;
    const maxHeight = Math.max(0, Math.min(desiredHeight, placeBelow ? below : above));
    const top = placeBelow ? rect.bottom + 6 : rect.top - 6 - maxHeight;
    setPlacement({
      left: Math.max(
        viewportLeft + 8,
        Math.min(rect.left, viewportLeft + viewportWidth - width - 8),
      ),
      top: Math.max(viewportTop + 8, Math.min(top, viewportTop + viewportHeight - maxHeight - 8)),
      width,
      maxHeight,
    });
  }

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0) {
    if (disabled || options.length === 0) return;
    updatePlacement();
    setActiveIndex(index);
    setOpen(true);
    triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePlacement();
    const reposition = () => updatePlacement();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (disabled || options.length === 0) setOpen(false);
    else setActiveIndex((index) => Math.min(index, options.length - 1));
  }, [disabled, options.length]);

  useEffect(() => {
    if (open) menuRef.current?.children[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!open)
        openMenu(
          selectedIndex >= 0 ? selectedIndex : event.key === "ArrowUp" ? options.length - 1 : 0,
        );
      else
        setActiveIndex(
          (index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
        );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const index = event.key === "Home" ? 0 : options.length - 1;
      if (!open) openMenu(index);
      else setActiveIndex(index);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(activeIndex);
      else openMenu();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="orbit-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (!menuRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
        }}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span>{options[selectedIndex]?.label ?? value}</span>
        <svg
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-label={`${label}の候補`}
            className="orbit-select-listbox"
            style={placement}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <button
                type="button"
                tabIndex={-1}
                role="option"
                id={`${id}-option-${index}`}
                key={option.value}
                data-value={option.value}
                aria-selected={value === option.value}
                className={`orbit-select-option ${activeIndex === index ? "active" : ""}`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
