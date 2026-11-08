import { useEffect, useRef, useState } from "react";
import { RECORD_PREVIEW_LIMIT } from "./record-history";

interface RecordPage<T> { items: T[]; total: number; page: number; totalPages: number }

/** Fetch 50 once; the compact view is a local slice of the same snapshot. */
export function useRecordHistory<T, R extends RecordPage<T>>(queryKey: string, load: (page: number, signal: AbortSignal) => Promise<R>, refreshKey?: unknown, pollIntervalMs?: number) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{ key: string; data: R } | null>(null);
  const result = snapshot?.key === queryKey ? snapshot.data : null;
  const [retryKey, setRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const cache = useRef<{ key: string; first: R | null }>({ key: queryKey, first: null });
  const lastRequest = useRef({ key: "", page: 0 });
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    activeRequest.current = controller;
    let nextPoll: number | undefined;
    if (cache.current.key !== queryKey) {
      cache.current = { key: queryKey, first: null };
    }
    if (page === 1 && cache.current.first) setSnapshot({ key: queryKey, data: cache.current.first });
    else if (lastRequest.current.key !== queryKey || lastRequest.current.page !== page) setLoading(true);
    lastRequest.current = { key: queryKey, page };
    setLoadError(false);
    const read = async () => {
      try {
        const data = await load(page, controller.signal);
        if (controller.signal.aborted) return;
        if (data.page === 1) cache.current.first = data;
        setSnapshot({ key: queryKey, data });
        setLoadError(false);
        if (data.page !== page) setPage(data.page);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (pollIntervalMs) nextPoll = window.setTimeout(read, pollIntervalMs);
        }
      }
    };
    void read();
    return () => { controller.abort(); window.clearTimeout(nextPoll); };
  }, [queryKey, load, page, refreshKey, retryKey, pollIntervalMs]);
  const reconcile = (update: (data: R, key: string) => R) => {
    // A read started before a confirmed write must not restore its old data.
    activeRequest.current?.abort();
    if (cache.current.first) cache.current.first = update(cache.current.first, cache.current.key);
    setSnapshot((current) => current && { ...current, data: update(current.data, current.key) });
    setRetryKey((value) => value + 1);
  };
  const toggleExpanded = (value: boolean) => {
    setExpanded(value);
    if (page !== 1) {
      if (cache.current.key === queryKey && cache.current.first) { setSnapshot({ key: queryKey, data: cache.current.first }); setLoading(false); }
      setPage(1);
    }
  };
  const showExpanded = expanded && (result?.total ?? 0) >= RECORD_PREVIEW_LIMIT;
  return { result, items: (showExpanded ? result?.items : result?.items.slice(0, RECORD_PREVIEW_LIMIT)) ?? [], expanded: showExpanded, toggleExpanded, page, setPage, loading, loadError, reconcile, retry: () => { setLoading(true); setRetryKey((value) => value + 1); } };
}
