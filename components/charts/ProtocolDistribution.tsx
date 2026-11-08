import { useId, useState, type CSSProperties, type HTMLAttributes } from "react";
import { useI18n } from "../../lib/i18n";
import type { TrafficBreakdown } from "../../lib/types";
import { Collapse } from "../ui/Collapse";
import { Icon } from "../ui/Icon";

const LEGEND_LIMIT = 5;
const COLORS = [
  "var(--chart-primary)",
  "var(--chart-secondary)",
  "var(--chart-tertiary)",
  "color-mix(in srgb, var(--chart-primary) 52%, var(--tertiary))",
  "color-mix(in srgb, var(--chart-secondary) 52%, var(--primary))",
  "color-mix(in srgb, var(--chart-tertiary) 52%, var(--secondary))",
];
const usage = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;

export function ProtocolDistribution({ data, totalBytes }: { data: TrafficBreakdown[]; totalBytes: number }) {
  const { t } = useI18n();
  const [active, setActive] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const moreId = useId();
  const hasMore = data.length > LEGEND_LIMIT;
  const visible = hasMore ? LEGEND_LIMIT - 1 : LEGEND_LIMIT;
  const entries = data.map((item, index) => ({ ...item, label: t(item.nameZh ?? item.name, item.nameEn ?? item.name), color: COLORS[index % COLORS.length] }));
  const selected = entries.find((item) => item.name === active);
  const interactions = (name: string): HTMLAttributes<HTMLButtonElement> => ({
    onPointerEnter: (event) => { if (event.pointerType === "mouse") setActive(name); },
    onPointerLeave: (event) => { if (event.pointerType === "mouse") setActive(null); },
    onPointerCancel: () => setActive(null),
    onFocus: () => setActive(name),
    onBlur: () => setActive(null),
    onClick: () => setActive(name),
    onKeyDown: (event) => { if (event.key === "Escape") setActive(null); },
  });
  const legendEntry = (item: typeof entries[number]) => <button key={item.name} type="button" className={selected?.name === item.name ? "is-active" : ""} {...interactions(item.name)}>
    <span className="dot" style={{ background: item.color }} /><span>{item.label}</span><b>{usage(item.value)}</b>
  </button>;

  return <div className="protocol-distribution">
    <div className="protocol-distribution__reading">
      <span>{selected?.label ?? t("分布合计", "Distribution total")}</span><strong>{usage(selected?.value ?? totalBytes)}</strong>
    </div>
    <div className="protocol-distribution__bar" role="group" aria-label={t("协议流量占比", "Protocol traffic shares")}>
      {totalBytes > 0 ? entries.filter((item) => item.value > 0).map((item) => <button
        key={item.name}
        type="button"
        className={selected?.name === item.name ? "is-active" : ""}
        aria-label={`${item.label} · ${usage(item.value)}`}
        style={{ flexBasis: `${100 * item.value / totalBytes}%`, "--segment-color": item.color } as CSSProperties}
        {...interactions(item.name)}
      />) : null}
    </div>
    <div className="protocol-distribution__legend">
      {entries.slice(0, visible).map(legendEntry)}
      {hasMore ? <button type="button" className="protocol-distribution__more" aria-expanded={more} aria-controls={moreId} onClick={() => { setMore(!more); setActive(null); }}>
        <Icon name="expand_more" size={18} /><span>{t("更多协议", "More protocols")}</span><b>+{entries.length - visible}</b>
      </button> : null}
    </div>
    {hasMore ? <Collapse expanded={more}><div className="protocol-distribution__legend" id={moreId}>{entries.slice(visible).map(legendEntry)}</div></Collapse> : null}
    {!entries.length ? <p className="muted">{t("暂无协议流量记录", "No protocol traffic records yet")}</p> : null}
  </div>;
}
