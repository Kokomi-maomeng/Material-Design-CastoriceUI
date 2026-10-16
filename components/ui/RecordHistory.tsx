import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { Button } from "./Button";
import { Icon } from "./Icon";

export function AnimatedRecords({ children, transitionKey, itemCount, ready = true }: { children: ReactNode; transitionKey: string; itemCount: number; ready?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previous = useRef({ height: 0, width: 0, key: transitionKey, count: itemCount, ready: false });
  useLayoutEffect(() => {
    const element = container.current, inner = content.current;
    if (!element || !inner || typeof ResizeObserver === "undefined") return;
    // Responsive reflow is a new baseline, not a record expansion. Keeping the
    // old desktop height would briefly shrink a mobile list and clamp scroll.
    const observer = new ResizeObserver(() => {
      const rect = inner.getBoundingClientRect();
      if (rect.width !== previous.current.width) element.getAnimations().forEach((animation) => animation.cancel());
      previous.current = { ...previous.current, height: rect.height, width: rect.width };
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = container.current, inner = content.current;
    if (!element || !inner) return;
    const { height, width } = inner.getBoundingClientRect();
    const before = previous.current;
    previous.current = { height, width, key: transitionKey, count: itemCount, ready };
    if (!element.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!before.ready || !ready) return;
    if (before.count === itemCount && before.key === transitionKey) return;
    if (before.width === width && before.height && height && before.height !== height) {
      const running = element.getAnimations();
      const startHeight = running.length ? element.getBoundingClientRect().height : before.height;
      running.forEach((animation) => animation.cancel());
      element.animate([{ height: `${startHeight}px`, overflow: "clip" }, { height: `${height}px`, overflow: "clip" }], { duration: 220, easing: "cubic-bezier(.2,0,0,1)" });
    }
    if (before.key !== transitionKey) inner.animate([{ opacity: .35, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
  });
  return <div ref={container} className="record-transition"><div ref={content}>{children}</div></div>;
}

function pageItems(current: number, total: number): Array<number | string> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, 2, total - 1, total, current - 1, current, current + 1])].filter((page) => page > 0 && page <= total).sort((a, b) => a - b);
  return pages.flatMap((page, index) => index && page - pages[index - 1] > 1 ? [`ellipsis-${page}`, page] : [page]);
}

export function RecordHistoryControls({ expanded, loading, total, page, totalPages, onExpandedChange, kind }: {
  expanded: boolean; loading: boolean; total: number; page: number; totalPages: number;
  onExpandedChange: (expanded: boolean) => void; kind: "audit" | "alerts";
}) {
  const { t } = useI18n();
  return <div className="audit-controls">
    <div><strong>{loading ? t("正在读取记录", "Loading records") : expanded ? t(`第 ${page}/${totalPages} 页`, `Page ${page} of ${totalPages}`) : t(`默认显示最近 ${Math.min(30, total)} 条`, `Showing the latest ${Math.min(30, total)} by default`)}</strong><span>{t(`总计 ${total} 条`, `${total} total records`)}</span></div>
    {!expanded ? <Button variant="outlined" icon="unfold_more" onClick={() => onExpandedChange(true)}>{kind === "audit" ? t("展开全部日志", "Show all logs") : t("展开全部记录", "Show all records")}</Button> : <Button variant="text" icon="unfold_less" onClick={() => onExpandedChange(false)}>{t("收起到最近 30 条", "Collapse to latest 30")}</Button>}
  </div>;
}

export function RecordPagination({ page, totalPages, onPageChange, label, loading = false }: { page: number; totalPages: number; onPageChange: (page: number) => void; label: string; loading?: boolean }) {
  const { t } = useI18n();
  const [jump, setJump] = useState("");
  const go = (next: number) => { if (!loading && Number.isSafeInteger(next)) onPageChange(Math.min(totalPages, Math.max(1, next))); };
  if (totalPages <= 1) return null;
  return <nav className="md-pagination" aria-label={label} aria-busy={loading}>
    <button onClick={() => go(page - 1)} disabled={loading || page === 1} aria-label={t("上一页", "Previous page")}><Icon name="chevron_left" size={18} /></button>
    {pageItems(page, totalPages).map((item) => typeof item === "number" ? <button key={item} disabled={loading} className={page === item ? "is-current" : ""} aria-current={page === item ? "page" : undefined} onClick={() => go(item)}>{item}</button> : <span key={item}>…</span>)}
    <button onClick={() => go(page + 1)} disabled={loading || page === totalPages} aria-label={t("下一页", "Next page")}><Icon name="chevron_right" size={18} /></button>
    <form onSubmit={(event) => { event.preventDefault(); go(Number(jump)); setJump(""); }}><label><span>{t("跳至", "Go to")}</span><input disabled={loading} inputMode="numeric" pattern="[0-9]*" value={jump} onChange={(event) => setJump(event.target.value.replace(/\D/g, ""))} aria-label={t("输入页码", "Enter page number")} /><span>/ {totalPages}</span></label><Button type="submit" compact disabled={loading || !jump}>{t("跳转", "Go")}</Button></form>
  </nav>;
}
