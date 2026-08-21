"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../lib/i18n";
import { Icon } from "./Icon";

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
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) => `${option.label} ${option.secondary ?? ""}`.toLocaleLowerCase().includes(needle))
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const roomBelow = window.innerHeight - rect.bottom - gap - 12;
      const roomAbove = rect.top - gap - 12;
      const maxHeight = Math.max(180, Math.min(420, Math.max(roomBelow, roomAbove)));
      const top = roomBelow >= Math.min(320, maxHeight)
        ? rect.bottom + gap
        : Math.max(12, rect.top - Math.min(maxHeight, 420) - gap);
      const width = Math.max(rect.width, Math.min(420, window.innerWidth - 24));
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      setPosition({ left, top, width, maxHeight });
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
    place();
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const focusTimer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
      else popupRef.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus();
    });
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, searchable]);

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
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span className={!selected ? "is-placeholder" : undefined}>{selected?.label ?? placeholder ?? t("请选择", "Select")}</span>
        <Icon name="arrow_drop_down" />
      </button>
      {open ? createPortal(
        <div
          ref={popupRef}
          className="md-select-menu"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
        >
          {searchable ? (
            <label className="md-select-search">
              <Icon name="search" size={19} />
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索选项", "Search options")} aria-label={t("搜索选项", "Search options")} />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}
            </label>
          ) : null}
          <div id={listboxId} className="md-select-list" role="listbox" aria-label={ariaLabel}>
            {filtered.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
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
