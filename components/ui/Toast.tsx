import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useI18n } from "../../lib/i18n";

export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [leaving, setLeaving] = useState(false);
  const closeTimer = useRef(0);
  const close = useCallback(() => {
    if (closeTimer.current) return;
    setLeaving(true);
    closeTimer.current = window.setTimeout(onDismiss, 220);
  }, [onDismiss]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(close, 3200);
    return () => window.clearTimeout(timer);
  }, [close, message]);

  if (!message) return null;
  return (
    <div className={`toast ${leaving ? "is-leaving" : ""}`} role="status">
      <Icon name="check_circle" size={20} filled />
      <span>{message}</span>
      <button type="button" onClick={close} aria-label={t("关闭提示", "Dismiss notification")}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
