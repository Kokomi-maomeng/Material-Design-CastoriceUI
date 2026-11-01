import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Icon } from "../ui/Icon";

export function NetworkHelp() {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  const leave = () => { cancel(); timer.current = setTimeout(close, 180); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <>
    <button className="md-button md-button--text network-help-button" ref={anchor} aria-haspopup="dialog" aria-expanded={open}
      onPointerEnter={(e) => { if (e.pointerType !== "touch") { cancel(); setOpen(true); } }} onPointerLeave={leave}
      onFocus={() => { cancel(); setOpen(true); }} onBlur={leave}
      onClick={() => { cancel(); setOpen(true); }}>
      <Icon name="help" size={19} /><span>{t("指标说明", "About metrics")}</span>
    </button>
    <AnchoredPopover open={open} anchorRef={anchor} onClose={close} ariaLabel={t("网络指标说明", "Network metrics")} preferredWidth={340} placementPreference="vertical" className="network-help"
      onPointerEnter={() => { cancel(); setOpen(true); }} onPointerLeave={leave}>
      {[
        ["timer", t("延迟", "Latency"), t("衡量请求往返时间，数值越低越好。", "Measures round-trip time; lower is better.")],
        ["ssid_chart", t("抖动", "Jitter"), t("反映多次真实探测之间的稳定程度。", "Shows stability across real probe responses.")],
        ["network_check", t("丢包", "Packet loss"), t("表示未收到响应的探测比例。", "The percentage of probes that received no response.")],
      ].map(([icon, title, description]) => <div key={icon}><Icon name={icon} /><div><strong>{title}</strong><p>{description}</p></div></div>)}
    </AnchoredPopover>
  </>;
}
