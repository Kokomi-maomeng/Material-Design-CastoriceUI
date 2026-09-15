"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useI18n } from "../../lib/i18n";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Icon } from "../ui/Icon";
interface DonutItem { name: string; value: number; color: string }

export function DonutChart({ data, centerLabel, centerValue, active, onActiveChange: setActive, surfaceRef }: { active: number | null; onActiveChange: (value: number | null) => void; data: DonutItem[]; centerLabel: string; centerValue: string; surfaceRef?: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const moreId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const localSurfaceRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const hasOverflow = data.length > 5;
  const visibleData = hasOverflow ? data.slice(0, 4) : data.slice(0, 5);
  const overflowData = hasOverflow ? data.slice(4) : [];
  const total = data.reduce((sum, item) => sum + item.value, 0); const radius = 72; const circumference = 2 * Math.PI * radius; const selected = active === null ? null : data[active];
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const closeMore = useCallback(() => {
    cancelClose();
    setMoreOpen(false);
    setActive(null);
  }, [cancelClose, setActive]);
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(closeMore, 140);
  };

  useEffect(() => cancelClose, [cancelClose]);

  return <div ref={localSurfaceRef} className="donut-wrap"><div className="chart chart--donut"><svg className="native-donut native-chart--interactive" viewBox="0 0 200 200" role="img" tabIndex={0} aria-label={t(`${centerLabel}分布图，可聚焦图例查看数值`, `${centerLabel} distribution chart; focus segments to inspect values`)} onKeyDown={(event) => { if (event.key === "Escape") setActive(null); }} onBlur={() => setActive(null)}>
    <circle className="donut-track" cx="100" cy="100" r={radius} />
    {data.map((item, index) => { const fraction = total > 0 ? item.value / total : 0; const length = Math.max(0, fraction * circumference - 3); const preceding = data.slice(0, index).reduce((sum, entry) => sum + entry.value, 0); const dashOffset = total > 0 ? -(preceding / total) * circumference : 0; return <circle key={item.name} className={`donut-segment ${active === index ? "is-active" : ""}`} cx="100" cy="100" r={radius} stroke={item.color} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={dashOffset} tabIndex={0} onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)} onFocus={() => setActive(index)} />; })}
  </svg><div className={`donut-center ${selected ? "is-inspecting" : ""}`}><strong>{selected ? `${selected.value.toFixed(2)} GB` : centerValue}</strong><span>{selected?.name ?? centerLabel}</span></div></div>
  <div className="chart-legend">{visibleData.map((item, index) => <button type="button" key={item.name} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><span><i style={{ background: item.color }} />{item.name}</span><b>{item.value.toFixed(1)} GB</b></button>)}
    {hasOverflow ? <button
      ref={moreButtonRef}
      type="button"
      className="chart-legend__more"
      aria-expanded={moreOpen}
      aria-controls={moreId}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          cancelClose();
          setMoreOpen(true);
        }
      }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(); }}
      onPointerUp={(event) => { if (event.pointerType !== "mouse") setMoreOpen((value) => !value); }}
      onClick={(event) => { if (event.detail === 0) setMoreOpen(true); }}
    ><span><Icon name="more_horiz" size={18} />{t("更多协议", "More protocols")}</span><b>+{overflowData.length}<Icon name="chevron_right" size={17} className={moreOpen ? "is-open" : ""} /></b></button> : null}
  </div>
  {hasOverflow ? <AnchoredPopover
    open={moreOpen}
    anchorRef={moreButtonRef}
    surfaceRef={surfaceRef ?? localSurfaceRef}
    onClose={closeMore}
    ariaLabel={t("更多协议流量", "More protocol traffic")}
    className="protocol-more-popover"
    onPointerEnter={cancelClose}
    onPointerLeave={scheduleClose}
  ><div id={moreId} className="protocol-more-list">{overflowData.map((item, offset) => {
    const index = offset + 4;
    return <button type="button" key={item.name} className={active === index ? "is-active" : ""} onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}><span><i style={{ background: item.color }} />{item.name}</span><b>{item.value.toFixed(1)} GB</b></button>;
  })}</div></AnchoredPopover> : null}</div>;
}
