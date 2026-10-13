import { useEffect, useState } from "react";
import { fetchAlertEvidence } from "../../lib/api";
import { formatLocalDateTime, localTimeZone } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { AlertEvidenceResponse, AlertEvidenceSample, AlertItem } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export function AlertEvidenceDialog({ alert, onClose }: { alert: AlertItem | null; onClose: () => void }) {
  const { language, t } = useI18n();
  const [data, setData] = useState<AlertEvidenceResponse | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const episodeId = alert?.episodeId;
  useEffect(() => {
    if (!episodeId) return;
    const controller = new AbortController();
    void fetchAlertEvidence(episodeId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [episodeId, retry]);
  const sampleTime = (sample: AlertEvidenceSample) => {
    const evidence = sample.evidence;
    const at = evidence?.observedAt ?? evidence?.service?.observedAt;
    const seconds = evidence?.sampledAt ?? evidence?.service?.sampledAt;
    return at ? formatLocalDateTime(at, language) : typeof seconds === "number" ? formatLocalDateTime(new Date(seconds * 1000).toISOString(), language) : t("未记录采样时间", "Sample time was not recorded");
  };
  return <Dialog open={alert !== null} onClose={onClose} title={t("告警证据", "Alert evidence")} description={t(`同一轮告警的原始读数 · ${localTimeZone()}`, `Original samples from this alert episode · ${localTimeZone()}`)} size="large" actions={<Button onClick={onClose}>{t("关闭", "Close")}</Button>}>
    {error ? <div role="alert"><p>{t("证据读取失败，请重试", "Unable to load evidence")}</p><Button onClick={() => setRetry((value) => value + 1)}>{t("重试", "Retry")}</Button></div> : !data ? <p role="status">{t("正在读取证据", "Loading evidence")}</p> : !data.available ? <p>{t("这条历史记录没有保留原始采样证据，无法补造首次或最坏读数。", "This historical episode has no saved samples. First and worst readings cannot be reconstructed.")}</p> : <div className="alert-evidence-grid">
      {(["first", "worst", "last"] as const).map((key) => {
        const sample = data[key];
        if (!sample) return null;
        const evidence = sample.evidence;
        return <section className="alert-evidence-sample" key={key}>
          <h3>{key === "first" ? t("首次发现", "First detected") : key === "worst" ? t("最坏读数", "Worst reading") : t("最近异常或待确认状态", "Latest abnormal or unconfirmed state")}</h3>
          <time>{sampleTime(sample)}</time>
          <strong>{language === "zh" ? sample.titleZh || sample.title : sample.titleEn || sample.title}</strong>
          <p>{language === "zh" ? sample.descriptionZh || sample.description : sample.descriptionEn || sample.description}</p>
          {evidence && (typeof evidence.latency === "number" || typeof evidence.loss === "number" || typeof evidence.sent === "number") ? <dl className="monitoring-evidence-list">
            <div><dt>{t("延迟", "Latency")}</dt><dd>{typeof evidence.latency === "number" ? `${evidence.latency} ms` : "—"}</dd></div>
            <div><dt>{t("丢包", "Loss")}</dt><dd>{typeof evidence.loss === "number" ? `${evidence.loss}%` : "—"}</dd></div>
            <div><dt>{t("发包 / 回包", "Sent / received")}</dt><dd>{evidence.sent ?? "—"} / {evidence.received ?? "—"}</dd></div>
            <div><dt>{t("采样完整性", "Completeness")}</dt><dd>{evidence.complete === true ? t("完整", "Complete") : evidence.complete === false ? t("未完成", "Incomplete") : "—"}</dd></div>
            {evidence.effectivePolicy ? <div><dt>{t("当时阈值", "Thresholds at the time")}</dt><dd>{evidence.effectivePolicy.latencyMs ?? "—"} ms / {evidence.effectivePolicy.lossPercent ?? "—"}%</dd></div> : null}
          </dl> : null}
        </section>;
      })}
    </div>}
  </Dialog>;
}
