import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Icon } from "../ui/Icon";

export function NetworkHelp() {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverDismissed = useRef(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const cancel = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);
  const dismiss = useCallback(() => {
    // Removing a hovered popup can generate another pointer-enter on the
    // trigger even when the pointer has not moved.
    hoverDismissed.current = true;
    cancel();
    close();
  }, [cancel, close]);
  const show = () => { cancel(); hoverDismissed.current = false; setOpen(true); };
  const leave = () => { cancel(); timer.current = setTimeout(close, 180); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <>
    <button className="md-button md-button--text network-help-button" ref={anchor} aria-haspopup="dialog" aria-expanded={open}
      onPointerEnter={(event) => { if (event.pointerType !== "touch" && !hoverDismissed.current) show(); }}
      onPointerMove={(event) => { if (hoverDismissed.current && event.pointerType !== "touch" && (event.movementX || event.movementY)) show(); }}
      onPointerLeave={leave} onFocus={show} onBlur={leave} onClick={show}>
      <Icon name="help" size={19} /><span>{t("指标说明", "About metrics")}</span>
    </button>
    <AnchoredPopover open={open} anchorRef={anchor} onClose={dismiss} ariaLabel={t("网络指标说明", "Network metrics")} preferredWidth={340} placementPreference="vertical" className="network-help"
      onPointerEnter={() => { if (!hoverDismissed.current) show(); }} onPointerLeave={leave}>
      {[
        ["timer", t("延迟", "Latency"), t("衡量请求往返时间，数值越低越好。", "Measures round-trip time; lower is better.")],
        ["ssid_chart", t("抖动", "Jitter"), t("反映多次真实探测之间的稳定程度。", "Shows stability across real probe responses.")],
        ["network_check", t("丢包", "Packet loss"), t("表示未收到响应的探测比例。", "The percentage of probes that received no response.")],
      ].map(([icon, title, description]) => <div key={icon}><Icon name={icon} /><div><strong>{title}</strong><p>{description}</p></div></div>)}
    </AnchoredPopover>
  </>;
}
