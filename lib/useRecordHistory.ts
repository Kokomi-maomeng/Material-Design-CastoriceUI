import { useEffect, useRef, useState } from "react";

interface RecordPage<T> { items: T[]; total: number; page: number; totalPages: number }

/** Fetch 50 once; the compact view is a local slice of the same snapshot. */
export function useRecordHistory<T, R extends RecordPage<T>>(queryKey: string, load: (page: number, signal: AbortSignal) => Promise<R>, refreshKey?: unknown) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const cache = useRef<{ key: string; first: R | null }>({ key: queryKey, first: null });
  const lastRequest = useRef({ key: "", page: 0 });
  useEffect(() => {
    const controller = new AbortController();
    if (cache.current.key !== queryKey) {
      cache.current = { key: queryKey, first: null };
    }
    if (page === 1 && cache.current.first) setResult(cache.current.first);
    else if (lastRequest.current.key !== queryKey || lastRequest.current.page !== page) setLoading(true);
    lastRequest.current = { key: queryKey, page };
    setLoadError(false);
    void load(page, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (data.page === 1) cache.current.first = data;
      setResult(data);
      if (data.page !== page) setPage(data.page);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [queryKey, load, page, refreshKey]);
  const toggleExpanded = (value: boolean) => {
    setExpanded(value);
    if (page !== 1) {
      if (cache.current.first) { setResult(cache.current.first); setLoading(false); }
      setPage(1);
    }
  };
  return { result, items: (expanded ? result?.items : result?.items.slice(0, 30)) ?? [], expanded, toggleExpanded, page, setPage, loading, loadError };
}
