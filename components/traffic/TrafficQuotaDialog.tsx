import { useState } from "react";
import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { TrafficQuotaSettings } from "../../lib/types";
import { SettingsSwitch } from "../settings/SettingsDialog";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialDatePicker } from "../ui/MaterialDatePicker";
import { MaterialSelect } from "../ui/MaterialSelect";

type QuotaUpdate = Pick<
  TrafficQuotaSettings,
  "bytes" | "autoReset" | "periodUnit" | "periodCount" | "resetAnchor" | "resetTime" | "timezone"
>;

const TIMEZONE_NAMES = (() => {
  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return ["UTC", ...supported.filter((value) => value !== "UTC")];
})();
const RESET_HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
const RESET_MINUTES = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));

export function TrafficQuotaDialog({
  trafficLimitBytes,
  quota,
  onClose,
  onSave,
  onToast,
}: {
  trafficLimitBytes: number;
  quota?: TrafficQuotaSettings;
  onClose: () => void;
  onSave: (settings: QuotaUpdate) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState(() => String(Math.max(1, Math.round(trafficLimitBytes / 1_000_000_000))));
  const [autoReset, setAutoReset] = useState(quota?.autoReset ?? false);
  const [periodUnit, setPeriodUnit] = useState<QuotaUpdate["periodUnit"]>(quota?.periodUnit ?? "month");
  const [periodCount, setPeriodCount] = useState(() => String(quota?.periodCount ?? 1));
  const [resetAnchor, setResetAnchor] = useState(() => quota?.resetAnchor ?? new Date().toISOString().slice(0, 10));
  const [resetTime, setResetTime] = useState(quota?.resetTime ?? "00:00");
  const [timezone, setTimezone] = useState(quota?.timezone ?? "UTC");
  const [error, setError] = useState("");

  const close = () => {
    if (!saving) onClose();
  };
  const save = async () => {
    const quotaGb = Number(limit);
    const count = Number(periodCount);
    if (!Number.isFinite(quotaGb) || quotaGb < 1 || quotaGb > 1_000_000) {
      setError(t("流量额度必须在 1 到 1,000,000 GB 之间", "Traffic quota must be between 1 and 1,000,000 GB"));
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(resetAnchor) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(resetTime)) {
      setError(t("请检查重置周期数量、日期和时间", "Check the reset interval, date, and time"));
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        bytes: Math.round(quotaGb * 1_000_000_000),
        autoReset,
        periodUnit,
        periodCount: count,
        resetAnchor,
        resetTime,
        timezone,
      });
      onClose();
      onToast(t("总流量额度已保存", "Traffic quota saved"));
    } catch (caught) {
      const message = caught instanceof ApiError && caught.code !== "request_failed"
        ? t(`保存失败：${caught.code}`, `Save failed: ${caught.code}`)
        : t("保存失败，请检查后端连接", "Save failed. Check the backend connection.");
      setError(message);
      onToast(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t("设置总流量额度", "Set total traffic quota")}
      className="quota-dialog"
      size="medium"
      actions={<><Button variant="text" onClick={close} disabled={saving}>{t("取消", "Cancel")}</Button><Button onClick={() => void save()} disabled={saving}>{saving ? t("保存中…", "Saving…") : t("保存", "Save")}</Button></>}
    >
      <label className="field">
        <span>{t("总流量（GB）", "Total traffic (GB)")}</span>
        <div className="quota-input-stable"><input aria-label={t("总流量（GB）", "Total traffic (GB)")} type="number" min="1" max="1000000" step="1" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} autoComplete="off" /><span>GB</span></div>
      </label>
      <div className="settings-row settings-row--switch quota-reset-switch">
        <span><Icon name="restart_alt" /><span><strong>{t("自动重置流量", "Automatic traffic reset")}</strong><small>{autoReset ? t("到达所选周期边界时从 0 开始新周期", "Start a new cycle at the selected boundary") : t("持续累计用量，不会自动归零", "Keep accumulating usage without automatic reset")}</small></span></span>
        <SettingsSwitch checked={autoReset} label={t("自动重置流量", "Automatic traffic reset")} onChange={() => setAutoReset((current) => !current)} />
      </div>
      {autoReset ? <div className="quota-schedule-grid">
        <label className="field"><span>{t("每隔", "Every")}</span><input type="number" min="1" max="365" step="1" inputMode="numeric" value={periodCount} onChange={(event) => setPeriodCount(event.target.value)} /></label>
        <div className="field"><span>{t("计费单位", "Billing unit")}</span><MaterialSelect ariaLabel={t("计费单位", "Billing unit")} value={periodUnit} options={[{ value: "day", label: t("日", "day(s)") }, { value: "week", label: t("周", "week(s)") }, { value: "month", label: t("月", "month(s)") }, { value: "year", label: t("年", "year(s)") }]} onChange={(value) => setPeriodUnit(value as typeof periodUnit)} /></div>
        <div className="field"><span>{t("重置基准日期", "Reset anchor date")}</span><MaterialDatePicker ariaLabel={t("重置基准日期", "Reset anchor date")} value={resetAnchor} onChange={setResetAnchor} /></div>
        <div className="field"><span>{t("重置时间", "Reset time")}</span><div className="quota-time-selects"><MaterialSelect ariaLabel={t("重置小时", "Reset hour")} value={resetTime.slice(0, 2)} options={RESET_HOURS.map((value) => ({ value, label: value }))} onChange={(value) => setResetTime(`${value}:${resetTime.slice(3, 5)}`)} /><span>:</span><MaterialSelect ariaLabel={t("重置分钟", "Reset minute")} value={resetTime.slice(3, 5)} options={RESET_MINUTES.map((value) => ({ value, label: value }))} onChange={(value) => setResetTime(`${resetTime.slice(0, 2)}:${value}`)} /></div></div>
        <div className="field field--wide"><span>{t("时区设定", "Timezone")}</span><MaterialSelect ariaLabel={t("时区设定", "Timezone")} value={timezone} searchable options={TIMEZONE_NAMES.map((value) => ({ value, label: value, secondary: value === "UTC" ? t("协调世界时", "Coordinated Universal Time") : undefined }))} onChange={setTimezone} /></div>
        <p className="field-hint quota-schedule-summary">{t(`每 ${periodCount || "?"} ${periodUnit === "day" ? "日" : periodUnit === "week" ? "周" : periodUnit === "month" ? "月" : "年"}重置；基准 ${resetAnchor || "—"} ${resetTime}，时区 ${timezone || "UTC"}`, `Reset every ${periodCount || "?"} ${periodUnit}(s), anchored on ${resetAnchor || "—"} ${resetTime} in ${timezone || "UTC"}`)}</p>
      </div> : null}
      {error ? <div className="dialog-error" role="alert"><Icon name="error" size={19} /><span>{error}</span></div> : null}
    </Dialog>
  );
}
