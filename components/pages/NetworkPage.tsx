"use client";

import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { AlertItem, IntegrationStatus, NetworkTarget } from "../../lib/types";
import { networkProbeSamples } from "../../lib/network-chart";
import { useNetworkTargets } from "../../lib/useNetworkTargets";
import { NetworkChart } from "../charts/NetworkChart";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { AlertTimes } from "../ui/AlertTimes";
import { AnimatedRecords } from "../ui/RecordHistory";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { NetworkHistory } from "./NetworkHistory";
import { NetworkProbeDialog } from "../network/NetworkProbeDialog";
import { NetworkHelp } from "../network/NetworkHelp";
import { networkQuality, qualityLabels } from "../../lib/network-quality";

export function NetworkPage({
  targets: initialTargets,
  onToast,
  integration,
  onConfigure,
  onSaved,
  alertIntegration,
  alerts = [],
  networkAlertCount,
  onOpenAlerts,
  onAcknowledgeAll,
  onCustomize,
}: {
  targets: NetworkTarget[];
  onToast: (message: string) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
  onSaved: () => Promise<void>;
  alertIntegration?: IntegrationStatus;
  alerts?: AlertItem[];
  networkAlertCount?: number;
  onOpenAlerts?: () => void;
  onAcknowledgeAll?: () => Promise<void>;
  onCustomize?: () => void;
}) {
  const { t } = useI18n();
  const targets = useNetworkTargets(initialTargets);
  const [version, setVersion] = useState<"all" | 4 | 6>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const filtered = useMemo(
    () =>
      targets.filter(
        (target) => version === "all" || (target.resolvedIpVersion ?? target.ipVersion) === version,
      ),
    [targets, version],
  );
  const measuredLatency = filtered.flatMap((item) => item.latency === null ? [] : [item.latency]);
  const measuredJitter = filtered.flatMap((item) => item.jitter === null ? [] : [item.jitter]);
  const avgLatency = measuredLatency.length ? measuredLatency.reduce((sum, value) => sum + value, 0) / measuredLatency.length : null;
  const avgJitter = measuredJitter.length ? measuredJitter.reduce((sum, value) => sum + value, 0) / measuredJitter.length : null;
  const available = filtered.filter((target) => target.status === "healthy" || target.status === "degraded").length;
  const state = networkQuality(filtered);
  const quality = t(qualityLabels[state][0], qualityLabels[state][1]);
  const grade = state === "excellent" ? "A" : state === "poor" ? "C" : "—";

  return (
    <div className="page-content page-enter network-page">
      <PageHeader
        eyebrow={t("链路可观测性", "Link observability")}
        title={t("网络质量", "Network quality")}
        actions={
          <>
          <NetworkHelp />
          <Button variant="tonal" icon="edit" onClick={onCustomize ?? (() => setEditorOpen(true))}>
            {t("自定义", "Customize")}
          </Button>
          </>
        }
      />
      <IntegrationGate
        status={integration}
        name="网络探测"
        nameEn="Network probes"
        description="配置 IPv4 / IPv6 探测目标。"
        descriptionEn="Configure IPv4 / IPv6 probe targets."
        onConfigure={onConfigure}
      />
      <div className="network-overview">
        <Card variant="elevated" className="network-score-card">
          <div className="network-grade">
            <span>{grade}</span>
          </div>
          <div>
            <small>{t("综合质量等级", "Overall quality")}</small>
            <strong>{quality}</strong>
            <p>
              {t(
                `${available} / ${filtered.length} 个目标可达`,
                `${available} of ${filtered.length} targets reachable`,
              )}
            </p>
          </div>
        </Card>
        <NetworkMetric
          icon="timer"
          label={t("平均延迟", "Average latency")}
          value={avgLatency !== null ? `${avgLatency.toFixed(1)} ms` : "—"}
          state={
            avgLatency !== null
              ? t("最近探测", "Latest probe")
              : t("等待探测", "Waiting")
          }
        />
        <NetworkMetric
          icon="ssid_chart"
          label={t("平均抖动", "Average jitter")}
          value={avgJitter !== null ? `${avgJitter.toFixed(1)} ms` : "—"}
          state={avgJitter !== null ? t("真实响应样本", "Real response samples") : t("探测不可用或无响应", "Probe unavailable or no reply")}
        />
        <NetworkMetric
          icon="public"
          label={t("可用目标", "Available targets")}
          value={`${available} / ${filtered.length}`}
          state={
            filtered.length === 0
              ? t("等待探测", "Waiting")
              : available === filtered.length
                ? t("全部可达", "All reachable")
                : t("存在异常", "Issues detected")
          }
        />
      </div>
      <NetworkAlerts integration={alertIntegration} alerts={alerts} pendingCount={networkAlertCount} onOpen={onOpenAlerts} onAcknowledgeAll={onAcknowledgeAll} onToast={onToast} />
      <section className="network-targets-section">
        <div className="network-targets-heading">
          <h2>{t("目标节点", "Targets")}</h2>
          <div className="segmented-control">
            <button
              className={version === "all" ? "is-selected" : ""}
              onClick={() => setVersion("all")}
            >
              {t("全部", "All")}
            </button>
            <button
              className={version === 4 ? "is-selected" : ""}
              onClick={() => setVersion(4)}
            >
              IPv4
            </button>
            <button
              className={version === 6 ? "is-selected" : ""}
              onClick={() => setVersion(6)}
            >
              IPv6
            </button>
          </div>
        </div>
        <AnimatedRecords itemCount={filtered.length} transitionKey={`${version}:${filtered.map((target) => target.id).join("|")}`}><div className="network-target-grid">
          {filtered.map((target) => (
            <Card variant="outlined" className="network-target-card" key={target.id}>
              <div className="network-target-card__header">
                <div className="provider-mark">{target.name.slice(0, 1)}</div>
                <div className="network-target__identity"><strong title={target.name}>{target.name}</strong><span title={target.address}>{target.address} · {(target.resolvedIpVersion ?? target.ipVersion) === 0 ? t("自动解析", "Automatic") : `IPv${target.resolvedIpVersion ?? target.ipVersion}`}</span></div>
                <Chip staticChip tone={target.status === "healthy" ? "success" : target.status === "down" ? "danger" : "warning"}>
                  {target.status === "healthy" ? t("正常", "Healthy") : target.status === "degraded" ? t("波动", "Degraded") : target.status === "unavailable" ? t("探测不可用", "Probe unavailable") : t("不可达", "Down")}
                </Chip>
              </div>
              <div className="network-target-card__content">
              <div className="network-target-card__metrics">
                <div className="network-measure"><span>{t("延迟", "Latency")}</span><b>{target.latency === null ? "—" : `${target.latency.toFixed(1)} ms`}</b></div>
                <div className="network-measure"><span>{t("抖动", "Jitter")}</span><b>{target.jitter === null ? "—" : `${target.jitter.toFixed(1)} ms`}</b></div>
                <div className="network-measure"><span>{t("丢包", "Loss")}</span><b className={target.status === "degraded" || target.status === "down" ? "text-warning" : ""}>{target.loss === null ? "—" : `${target.loss.toFixed(1)}%`}</b></div>
              </div>
              <div className="network-target-card__evidence">
              <div className="network-target-card__chart">
                <div className="network-target-card__chart-title"><strong>{t("网络探测", "Network probe")}</strong><b>{target.latency === null ? "—" : `${target.latency.toFixed(1)} ms`}</b></div>
                <NetworkChart samples={networkProbeSamples(target)} seconds step={target.sampleIntervalSeconds ?? 1} label={t(`${target.name} 网络探测`, `${target.name} network probe`)} />
              </div>
              <NetworkHistory key={target.id} target={target} />
              <ProbeReadings target={target} />
              </div>
              </div>
            </Card>
          ))}
        </div></AnimatedRecords>
      </section>
      {!onCustomize ? <NetworkProbeDialog open={editorOpen} onClose={() => setEditorOpen(false)} targets={targets} alertIntegration={alertIntegration} onSaved={onSaved} onToast={onToast} /> : null}
    </div>
  );
}

function ProbeReadings({ target }: { target: NetworkTarget }) {
  const { language, t } = useI18n();
  return <dl className="network-probe-readings">
    {(["icmp", "tcp", "dns"] as const).map((method) => {
      const layer = target.layers?.[method];
      const enabled = method === "icmp" || (method === "tcp" ? Boolean(target.tcpPort) : Boolean(target.dnsPort || target.dnsName)) || layer?.configured === true;
      const at = method === "icmp" ? target.observedAt : layer?.observedAt;
      const validAt = at && Number.isFinite(Date.parse(at));
      const duration = method === "icmp" ? target.latency : layer?.status === "passed" ? layer.durationMs : null;
      return <div key={method} className={enabled ? "" : "is-empty"} aria-hidden={!enabled}>
        <dt>{method === "icmp" ? t("ICMP 采样", "ICMP") : method === "tcp" ? "TCP" : "DNS(UDP)"}</dt>
        <dd><time dateTime={validAt ? at : undefined}>{validAt ? new Date(at).toLocaleTimeString(language === "zh" ? "zh-CN" : "en-GB", { hour12: false }) : "—"}</time><span>{typeof duration === "number" && Number.isFinite(duration) ? duration.toFixed(1) : "—"} ms</span></dd>
      </div>;
    })}
  </dl>;
}

const NETWORK_ALERT_LIMIT = 5;

function NetworkAlerts({ integration, alerts, pendingCount, onOpen, onAcknowledgeAll, onToast }: { integration?: IntegrationStatus; alerts: AlertItem[]; pendingCount?: number; onOpen?: () => void; onAcknowledgeAll?: () => Promise<void>; onToast: (message: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const networkAlerts = alerts.filter((item) => item.id.startsWith("network-") && !item.acknowledged);
  const count = busy ? 0 : pendingCount ?? networkAlerts.length;
  const visible = count ? networkAlerts.slice(0, NETWORK_ALERT_LIMIT) : [];
  const showMore = count > NETWORK_ALERT_LIMIT && Boolean(onOpen);
  const liveKey = visible.map((item) => item.episodeId ?? item.id).join("|") + (showMore ? "|more" : "");
  const confirm = async () => {
    if (busy || !onAcknowledgeAll) return;
    setBusy(true);
    try { await onAcknowledgeAll(); }
    catch { onToast(t("告警确认失败，请重试", "Unable to acknowledge the alert. Try again.")); }
    finally { setBusy(false); }
  };

  return <Card variant="outlined" className="network-alerts-card">
    <div className="network-alerts-card__heading"><div className="network-alerts-card__title"><h2>{t("网络告警", "Network alerts")}</h2><Chip staticChip tone="info">{integration?.enabled === false ? t("已停用", "Disabled") : `${count} ${t("项提醒", "reminders")}`}</Chip></div><div className="network-alerts-card__actions">{onAcknowledgeAll ? <Button variant="text" compact icon="done_all" disabled={busy || !count} onClick={() => void confirm()}>{t("全部确认", "Acknowledge all")}</Button> : null}{onOpen ? <Button variant="text" icon="notifications" onClick={onOpen}>{t("告警中心", "Alert center")}</Button> : null}</div></div>

    <AnimatedRecords itemCount={visible.length} transitionKey="network-alerts" liveKey={liveKey}>
      {count > 0 ? <div className="network-alerts-card__list" role="list">{visible.map((item) => <div role="listitem" key={item.episodeId ?? item.id} data-live-record={item.episodeId ?? item.id}><div className="network-alerts-card__message"><strong>{t(item.titleZh ?? item.title, item.titleEn ?? item.title)}</strong><span>{t(item.descriptionZh ?? item.description, item.descriptionEn ?? item.description)}</span></div><AlertTimes alert={item} /></div>)}</div> : null}
      {showMore ? <div className="network-alerts-card__more" data-live-record="more"><Button variant="text" compact icon="arrow_forward" onClick={onOpen}>{t("更多记录前往告警中心查看", "See more records in the alert center")}</Button></div> : null}
      {!count ? <p className="network-alerts-card__empty" role="status" data-live-record="empty">{t("所有问题已确认，更多前往告警中心查看", "All issues acknowledged. See the alert center for more.")}</p> : null}
    </AnimatedRecords>
  </Card>;
}

function NetworkMetric({
  icon,
  label,
  value,
  state,
}: {
  icon: string;
  label: string;
  value: string;
  state: string;
}) {
  return (
    <Card variant="filled" className="network-metric">
      <span>
        <Icon name={icon} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{state}</em>
      </div>
    </Card>
  );
}
