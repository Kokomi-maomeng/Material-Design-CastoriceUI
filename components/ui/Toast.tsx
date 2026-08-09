import { useEffect } from "react";
import { Icon } from "./Icon";

export function Toast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="toast" role="status">
      <Icon name="check_circle" size={20} filled />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="关闭提示">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
