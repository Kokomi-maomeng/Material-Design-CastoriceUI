import { formatLocalDateTime } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { AlertItem } from "../../lib/types";

export function AlertTimes({ alert }: { alert: AlertItem }) {
  const { language, t } = useI18n();
  return <div className="alert-row__times">
    <span>{t("开始", "Started")} <time dateTime={alert.startedAt}>{formatLocalDateTime(alert.startedAt, language)}</time></span>
    {alert.resolvedAt ? <span>{t("已恢复", "Recovered")} <time dateTime={alert.resolvedAt}>{formatLocalDateTime(alert.resolvedAt, language)}</time></span> : <span>{t("正在发生", "Active")}</span>}
    {alert.lastStartedAt && alert.lastStartedAt !== alert.startedAt && (alert.repeatCount ?? 1) > 1 ? <span>{t("最近发生", "Last occurrence")} <time dateTime={alert.lastStartedAt}>{formatLocalDateTime(alert.lastStartedAt, language)}</time></span> : null}
    {alert.acknowledgedAt ? <span>{t("确认", "Acknowledged")} <time dateTime={alert.acknowledgedAt}>{formatLocalDateTime(alert.acknowledgedAt, language)}</time></span> : null}
  </div>;
}
