"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import { Icon } from "./Icon";
import { usePresence } from "./usePresence";

export interface MaterialSelectOption {
  value: string;
  label: string;
  secondary?: string;
}

export function MaterialSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  searchable = false,
  disabled = false,
}: {
  value: string;
  options: MaterialSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState(value);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320, placement: "bottom" as "top" | "bottom", ready: false });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const present = usePresence(open, 180);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) => `${option.label} ${option.secondary ?? ""}`.toLocaleLowerCase().includes(needle))
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open || !present) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!rect || !popup) return;
      const gap = 6;
      const edge = 12;
      const roomBelow = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
      const roomAbove = Math.max(0, rect.top - gap - edge);
      const width = Math.max(1, Math.min(Math.max(rect.width, 240), window.innerWidth - 24));
      const desiredHeight = Math.min(420, Math.max(46, popup.scrollHeight));
      const placement = roomBelow >= desiredHeight || roomBelow >= roomAbove ? "bottom" : "top";
      const available = placement === "bottom" ? roomBelow : roomAbove;
      const maxHeight = Math.max(1, Math.min(420, available));
      const height = Math.min(desiredHeight, maxHeight);
      const unclampedTop = placement === "bottom" ? rect.bottom + gap : rect.top - gap - height;
      const top = Math.min(Math.max(edge, unclampedTop), Math.max(edge, window.innerHeight - height - edge));
      const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - width - edge));
      setPosition({ left, top, width, maxHeight, placement, ready: true });
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const placementFrame = window.requestAnimationFrame(place);
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const focusTimer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
      else (popupRef.current?.querySelector<HTMLElement>("[aria-selected='true']") ?? popupRef.current?.querySelector<HTMLElement>("[role='option']"))?.focus();
    });
  return () => {
      window.clearTimeout(focusTimer);
      window.cancelAnimationFrame(placementFrame);
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, present, searchable]);

    const navigateOptions = (event: ReactKeyboardEvent<HTMLElement>) => {
            const buttons = Array.from(popupRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
            if (!buttons.length) return;
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let index: number;
            if (event.key === "ArrowDown") index = current < 0 ? 0 : (current + 1) % buttons.length;
            else if (event.key === "ArrowUp") index = current < 0 ? buttons.length - 1 : (current + buttons.length - 1) % buttons.length;
            else if (event.key === "Home" && current >= 0) index = 0;
            else if (event.key === "End" && current >= 0) index = buttons.length - 1;
            else if (event.key === "Enter" && current < 0) { event.preventDefault(); buttons[0].click(); return; }
            else return;
            event.preventDefault();
            event.stopPropagation();
            setActiveValue(filtered[index].value);
            buttons[index].focus();
            buttons[index].scrollIntoView?.({ block: "nearest" });
            };


  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`md-select-trigger ${open ? "is-open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setQuery("");
            setActiveValue(value);
            setPosition((current) => ({ ...current, ready: false }));
            setOpen(true);
          }
        }}
        onClick={() => {
          setQuery("");
          setActiveValue(value);
          setOpen((current) => {
            if (!current) setPosition((value) => ({ ...value, ready: false }));
            return !current;
          });
        }}
      >
        <span className={!selected ? "is-placeholder" : undefined}>{selected?.label ?? placeholder ?? t("请选择", "Select")}</span>
        <Icon name="arrow_drop_down" />
      </button>
      {present ? createPortal(
        <div
          ref={popupRef}
          className={`md-select-menu md-floating-panel ${open ? "is-open" : "is-closing"}`}
          data-placement={position.placement}
          aria-hidden={!open}
          role="group"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, visibility: position.ready ? undefined : "hidden" }}
        >
          {searchable ? (
            <label className="md-select-search">
              <Icon name="search" size={19} />
              <input onKeyDown={navigateOptions} ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索选项", "Search options")} aria-label={t("搜索选项", "Search options")} />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}
            </label>
          ) : null}
          <div id={listboxId} className="md-select-list" role="listbox" onKeyDown={navigateOptions} tabIndex={-1} aria-label={ariaLabel}>
            {filtered.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={option.value === activeValue || (!filtered.some((item) => item.value === activeValue) && option === filtered[0]) ? 0 : -1}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span><strong>{option.label}</strong>{option.secondary ? <small>{option.secondary}</small> : null}</span>
                {option.value === value ? <Icon name="check" size={19} /> : null}
              </button>
            ))}
            {!filtered.length ? <p className="md-select-empty">{t("没有匹配的选项", "No matching options")}</p> : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
