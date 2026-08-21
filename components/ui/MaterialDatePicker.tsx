"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import { Icon } from "./Icon";

const parseDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const isoDate = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");

export function MaterialDatePicker({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const { language, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const selected = parseDate(value);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const selected = parseDate(value);
  const locale = language === "zh" ? "zh-CN" : "en";
  const weekdays = t("日,一,二,三,四,五,六", "S,M,T,W,T,F,S").split(",");
  const days = useMemo(() => {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: lastDay }, (_, index) => index + 1)];
  }, [month]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(328, window.innerWidth - 24);
      const estimatedHeight = 392;
      const top = window.innerHeight - rect.bottom >= estimatedHeight
        ? rect.bottom + 6
        : Math.max(12, rect.top - estimatedHeight - 6);
      setPosition({ left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12), top });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    place();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, value]);

  return (
    <>
      <button ref={buttonRef} type="button" className={`md-date-trigger ${open ? "is-open" : ""}`} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) { const current = parseDate(value); setMonth(new Date(current.getFullYear(), current.getMonth(), 1)); } setOpen((current) => !current); }}>
        <Icon name="calendar_month" size={20} />
        <span>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(selected)}</span>
      </button>
      {open ? createPortal(
        <div ref={popupRef} className="md-date-picker" role="dialog" aria-modal="false" aria-label={ariaLabel} style={{ left: position.left, top: position.top }}>
          <div className="md-date-picker__headline"><small>{t("选择日期", "Select date")}</small><strong>{new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(selected)}</strong></div>
          <div className="md-date-picker__month">
            <strong>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(month)}</strong>
            <span>
              <button type="button" aria-label={t("上个月", "Previous month")} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><Icon name="chevron_left" /></button>
              <button type="button" aria-label={t("下个月", "Next month")} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><Icon name="chevron_right" /></button>
            </span>
          </div>
          <div className="md-date-picker__grid">
            {weekdays.map((weekday, index) => <span className="md-date-picker__weekday" key={`${weekday}-${index}`}>{weekday}</span>)}
            {days.map((day, index) => day === null ? <span key={`empty-${index}`} /> : (
              <button
                type="button"
                key={day}
                className={selected.getFullYear() === month.getFullYear() && selected.getMonth() === month.getMonth() && selected.getDate() === day ? "is-selected" : ""}
                aria-label={new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(new Date(month.getFullYear(), month.getMonth(), day))}
                onClick={() => {
                  onChange(isoDate(new Date(month.getFullYear(), month.getMonth(), day)));
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >{day}</button>
            ))}
          </div>
          <div className="md-date-picker__actions">
            <button type="button" onClick={() => setOpen(false)}>{t("取消", "Cancel")}</button>
            <button type="button" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); onChange(isoDate(today)); setOpen(false); }}>{t("今天", "Today")}</button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
