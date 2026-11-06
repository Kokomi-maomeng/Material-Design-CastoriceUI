import { useState } from "react";
import { RECORD_PAGE_SIZE, RECORD_PREVIEW_LIMIT } from "./record-history";

/** Use the same compact view and expanded pages as server-backed histories. */
export function useLocalRecordHistory<T>(items: T[], queryKey: string) {
  const [view, setView] = useState({ key: queryKey, expanded: false, page: 1 });
  const current = view.key === queryKey ? view : { key: queryKey, expanded: view.expanded, page: 1 };
  const expanded = current.expanded && items.length >= RECORD_PREVIEW_LIMIT;
  const totalPages = Math.max(1, Math.ceil(items.length / RECORD_PAGE_SIZE));
  const page = expanded ? Math.min(current.page, totalPages) : 1;
  // Match server-backed histories: keep the expansion preference, but reset
  // filters to page one and retain a clamp when polling removes a later page.
  if (view.key !== queryKey || view.page !== page) setView({ ...current, page });
  return {
    items: expanded ? items.slice((page - 1) * RECORD_PAGE_SIZE, page * RECORD_PAGE_SIZE) : items.slice(0, RECORD_PREVIEW_LIMIT),
    expanded, page, totalPages,
    toggleExpanded: (value: boolean) => setView({ key: queryKey, expanded: value, page: 1 }),
    setPage: (value: number) => setView({ key: queryKey, expanded, page: Math.max(1, Math.min(totalPages, value)) }),
  };
}
