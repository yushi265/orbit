import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { OrbitIcon } from "./orbit-icon";

function dateParts(value: string): [number, number] {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (match) return [Number(match[1]), Number(match[2]) - 1];
  const today = new Date();
  return [today.getFullYear(), today.getMonth()];
}

export function OrbitDatePicker({
  id,
  label,
  value,
  onChange,
  onInput,
  disabled = false,
  ariaInvalid,
  ariaDescribedBy,
  onKeyDown,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInput?: (value: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [month, setMonth] = useState<[number, number]>(() => dateParts(value));
  const [year, monthIndex] = month;
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function moveMonth(offset: number) {
    const next = new Date(year, monthIndex + offset, 1);
    setMonth([next.getFullYear(), next.getMonth()]);
  }

  return (
    <div
      ref={pickerRef}
      className="orbit-date-picker"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        } else onKeyDown?.(event);
      }}
    >
      <input
        id={id}
        type="date"
        aria-label={label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onInput={onInput ? (event) => onInput(event.currentTarget.value) : undefined}
      />
      <button
        ref={triggerRef}
        type="button"
        className="orbit-calendar-trigger"
        aria-label={`${label}のカレンダー`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) setMonth(dateParts(value));
          setOpen(!open);
        }}
      >
        <OrbitIcon name="calendar" size={20} />
      </button>
      {open && (
        <div className="orbit-calendar" role="group" aria-label={`${label}のカレンダー`}>
          <div className="orbit-calendar-header">
            <button type="button" aria-label="前の月" onClick={() => moveMonth(-1)}>
              ‹
            </button>
            <strong>
              {year}年{monthIndex + 1}月
            </strong>
            <button type="button" aria-label="次の月" onClick={() => moveMonth(1)}>
              ›
            </button>
          </div>
          <div className="orbit-calendar-grid">
            {["日", "月", "火", "水", "木", "金", "土"].map((day) => (
              <span key={day} className="orbit-calendar-weekday">
                {day}
              </span>
            ))}
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              return (
                <button
                  type="button"
                  key={key}
                  aria-label={`${year}年${monthIndex + 1}月${day}日`}
                  aria-pressed={value === key}
                  className={key === todayKey ? "today" : undefined}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="orbit-calendar-footer">
            <button
              type="button"
              onClick={() => {
                onChange(todayKey);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              今日
            </button>
            <button
              type="button"
              aria-label="日付を解除"
              onClick={() => {
                onChange("");
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              解除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
