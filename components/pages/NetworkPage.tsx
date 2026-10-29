"use client";

import { useMemo, useState } from "react";
import { updateNetworkTargets } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { AlertItem, IntegrationStatus, NetworkTarget } from "../../lib/types";
import { networkProbeSamples } from "../../lib/network-chart";
import { useNetworkTargets } from "../../lib/useNetworkTargets";
import { NetworkChart } from "../charts/NetworkChart";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { PageHeader } from "../ui/Page";
import { NetworkHistory } from "./NetworkHistory";
import { networkQuality, qualityLabels } from "../../lib/network-quality";

interface TargetDraft {
  ipVersion: 0 | 4 | 6;
  name: string;
  address: string;
  order: number;
  tcpPort?: number;
  dnsPort?: number;
  dnsName?: string;
}

export function NetworkPage({
  targets: initialTargets,
  onToast,
  integration,
  onConfigure,
  onSaved,
  alertIntegration,
  alerts = [],
  onOpenAlerts,
}: {
  targets: NetworkTarget[];
  onToast: (message: string) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
  onSaved: () => Promise<void>;
  alertIntegration?: IntegrationStatus;
  alerts?: AlertItem[];
  onOpenAlerts?: () => void;
}) {
  const { t } = useI18n();
  const targets = useNetworkTargets(initialTargets);
  const [version, setVersion] = useState<"all" | 4 | 6>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<TargetDraft[]>([]);
  const [globalDraft, setGlobalDraft] = useState({ latencyMs: "", lossPercent: "" });
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
  const openEditor = () => {
    setDrafts(
      targets.map((target, index) => ({
        ...Object.fromEntries(Object.entries(target).filter(([key]) => ["tcpPort", "dnsPort", "dnsName"].includes(key))),
        ipVersion: target.ipVersion,
        name: target.name,
        address: target.address,
        order: target.order ?? index + 1,
      })),
    );
    setGlobalDraft({ latencyMs: alertIntegration?.values?.latencyMs ?? "", lossPercent: alertIntegration?.values?.lossPercent ?? "" });
    setEditorOpen(true);
  };
  const change = (index: number, key: keyof TargetDraft, value: string) =>
    setDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, [key]: ["order", "ipVersion", "tcpPort", "dnsPort"].includes(key) ? (value === "" ? undefined : Number(value)) : value }
          : item,
      ),
    );
  const save = async () => {
    setSaving(true);
    try {
      const globalThresholds = globalDraft.latencyMs !== "" && globalDraft.lossPercent !== "" ? { latencyMs: Number(globalDraft.latencyMs), lossPercent: Number(globalDraft.lossPercent) } : undefined;
      await updateNetworkTargets(drafts.map((item) => ({ ...item, dnsName: item.dnsName?.trim() || undefined })), globalThresholds);
      await onSaved();
      setEditorOpen(false);
      onToast(t("网络探测目标已保存", "Network probe targets saved"));
    } catch {
      onToast(t(
        "保存失败，请检查探测目标与全局告警设置",
        "Unable to save. Check probe targets and global alert settings.",
      ));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-content page-enter network-page">
      <PageHeader
        eyebrow={t("链路可观测性", "Link observability")}
        title={t("网络质量", "Network quality")}
        actions={
          <Button variant="tonal" icon="edit" onClick={openEditor}>
            {t("自定义", "Customize")}
          </Button>
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
      <FeatureIntro
        items={[
          {
            icon: "timer",
            title: t("延迟", "Latency"),
            description: t(
              "衡量请求往返时间，数值越低越好。",
              "Measures round-trip time; lower is better.",
            ),
          },
          {
            icon: "ssid_chart",
            title: t("抖动", "Jitter"),
            description: t(
              "反映多次真实探测之间的稳定程度。",
              "Shows stability across real probe responses.",
            ),
          },
          {
            icon: "network_check",
            title: t("丢包", "Packet loss"),
            description: t(
              "表示未收到响应的探测比例。",
              "The percentage of probes that received no response.",
            ),
          },
        ]}
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
      <NetworkAlerts integration={alertIntegration} alerts={alerts} onOpen={onOpenAlerts} />
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
        <div className="network-target-grid">
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
        </div>
      </section>
      <Dialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={t("自定义网络探测", "Customize network probes")}
        description={t(
          "编辑名称、地址和顺序；最多 12 个目标",
          "Edit names, addresses, and order for up to 12 targets",
        )}
        size="large"
        actions={
          <>
            <Button variant="text" onClick={() => setEditorOpen(false)}>
              {t("取消", "Cancel")}
            </Button>
            <Button
              icon="save"
              disabled={
                saving ||
                drafts.length === 0 ||
                Boolean(globalDraft.latencyMs) !== Boolean(globalDraft.lossPercent) ||
                Boolean(alertIntegration) && (globalDraft.latencyMs === "" || globalDraft.lossPercent === "") ||
                (globalDraft.latencyMs !== "" && (!Number.isFinite(Number(globalDraft.latencyMs)) || Number(globalDraft.latencyMs) < 0 || Number(globalDraft.latencyMs) > 60000)) ||
                (globalDraft.lossPercent !== "" && (!Number.isFinite(Number(globalDraft.lossPercent)) || Number(globalDraft.lossPercent) < 0 || Number(globalDraft.lossPercent) > 100)) ||
                drafts.some((item) => !item.name.trim() || !item.address.trim())
              }
              onClick={() => void save()}
            >
              {saving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </Button>
          </>
        }
      >
        <div className="network-editor">
          <fieldset className="network-alert-editor"><legend>{t("全局网络告警", "Global network alerts")}</legend><div className="form-grid">
            <label><span>{t("延迟阈值 (ms)", "Latency threshold (ms)")}</span><input type="number" min="0" max="60000" value={globalDraft.latencyMs} onChange={(event) => setGlobalDraft((current) => ({ ...current, latencyMs: event.target.value }))} /></label>
            <label><span>{t("丢包阈值 (%)", "Loss threshold (%)")}</span><input type="number" min="0" max="100" step="0.1" value={globalDraft.lossPercent} onChange={(event) => setGlobalDraft((current) => ({ ...current, lossPercent: event.target.value }))} /></label>
          </div></fieldset>
          {drafts.map((item, index) => (
            <div
              className="network-editor-row"
                key={index}
            >
              <label>
                <span>{t("名称", "Name")}</span>
                <input
                  maxLength={60}
                  value={item.name}
                  onChange={(event) =>
                    change(index, "name", event.target.value)
                  }
                />
              </label>
              <label>
                <span>{t("探测地址", "Probe address")}</span>
                <input
                  value={item.address}
                  onChange={(event) =>
                    change(index, "address", event.target.value)
                  }
                  placeholder="1.1.1.1"
                />
              </label>
              <label>
                <span>{t("排序", "Order")}</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={item.order}
                  onChange={(event) =>
                    change(index, "order", event.target.value)
                  }
                />
              </label>
              <label>
                <span>{t("解析协议族", "Address family")}</span>
                <MaterialSelect ariaLabel={t("解析协议族", "Address family")} value={String(item.ipVersion)} onChange={(value) => change(index, "ipVersion", value)} options={[{ value: "0", label: t("自动", "Automatic") }, { value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }]} />
              </label>
              <div className="network-target-editor-probes">{(["tcpPort", "dnsPort"] as const).map((key) => <label key={key}><span>{key === "tcpPort" ? t("TCP 端口", "TCP port") : t("DNS(UDP) 端口", "DNS(UDP) port")}</span><input type="number" min="1" max="65535" value={item[key] ?? ""} onChange={(event) => change(index, key, event.target.value)} placeholder={t("未启用", "Disabled")} /></label>)}<label><span>{t("DNS 验证名称", "DNS check name")}</span><input value={item.dnsName ?? ""} onChange={(event) => change(index, "dnsName", event.target.value)} placeholder="example.com" /></label></div>
              <button
                className="icon-button"
                aria-label={t("删除目标", "Remove target")}
                onClick={() =>
                  setDrafts((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <Icon name="delete" />
              </button>
            </div>
          ))}
          <Button
            variant="tonal"
            icon="add"
            disabled={drafts.length >= 12}
            onClick={() =>
              setDrafts((current) => [
                ...current,
                { name: "", address: "", order: current.length + 1, ipVersion: 0 },
              ])
            }
          >
            {t("添加目标", "Add target")}
          </Button>
        </div>
      </Dialog>
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

function NetworkAlerts({ integration, alerts, onOpen }: { integration?: IntegrationStatus; alerts: AlertItem[]; onOpen?: () => void }) {
  const { t } = useI18n();
  const networkAlerts = alerts.filter((item) => item.id.startsWith("network-"));
  const rule = (key: string) => { const raw = integration?.values?.[key]; return raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? String(Number(raw)) : "—"; };
  return <Card variant="outlined" className="network-alerts-card">
    <div className="network-alerts-card__heading"><h2>{t("网络告警", "Network alerts")}</h2>{onOpen ? <Button variant="text" icon="notifications" onClick={onOpen}>{t("告警中心", "Alert center")}</Button> : null}</div>
    <div className="network-alerts-card__rules"><span>{t("全局延迟", "Global latency")} <b>≥ {rule("latencyMs")} ms</b></span><span>{t("全局丢包", "Global loss")} <b>≥ {rule("lossPercent")}%</b></span><Chip staticChip tone={networkAlerts.length || integration?.enabled === false ? "warning" : "success"}>{integration?.enabled === false ? t("已停用", "Disabled") : `${networkAlerts.length} ${t("项告警", "alerts")}`}</Chip></div>
    {networkAlerts.length ? <div className="network-alerts-card__list" role="list">{networkAlerts.map((item) => <div role="listitem" key={item.episodeId ?? item.id}><strong>{t(item.titleZh ?? item.title, item.titleEn ?? item.title)}</strong><span>{t(item.descriptionZh ?? item.description, item.descriptionEn ?? item.description)}</span></div>)}</div> : null}
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
