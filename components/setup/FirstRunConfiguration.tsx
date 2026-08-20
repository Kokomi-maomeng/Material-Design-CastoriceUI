import { useState } from "react";
import type { IntegrationId, IntegrationStatus, OverviewMetrics } from "../../lib/types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";

const OPTIONAL_PROTOCOLS: Array<{ id: IntegrationId; label: string; icon: string }> = [
  { id: "hysteria2", label: "Hysteria2", icon: "bolt" },
  { id: "anytls", label: "AnyTLS", icon: "encrypted" },
  { id: "vless", label: "VLESS", icon: "route" },
  { id: "socks5", label: "SOCKS5", icon: "lan" },
  { id: "shadowsocks", label: "Shadowsocks", icon: "shield" },
  { id: "vmess", label: "VMess", icon: "hub" },
  { id: "trojan", label: "Trojan", icon: "security" },
  { id: "tuic", label: "TUIC", icon: "speed" },
];

export function FirstRunConfiguration({ metrics, integrations, onConfigure, onSaveBasics, onComplete }: {
  metrics: OverviewMetrics;
  integrations: IntegrationStatus[];
  onConfigure: (id: IntegrationId) => void;
  onSaveBasics: (nodeName: string, quotaGb: string) => Promise<void>;
  onComplete: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [nodeName, setNodeName] = useState(metrics.nodeName === "VPS node" ? "" : metrics.nodeName);
  const [quotaGb, setQuotaGb] = useState(String(Math.max(1, Math.round(metrics.trafficLimitBytes / 1_000_000_000))));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try { await onSaveBasics(nodeName.trim(), quotaGb); setSaved(true); } finally { setBusy(false); }
  };
  const complete = async () => { setBusy(true); try { await onComplete(); } finally { setBusy(false); } };
  const status = (id: IntegrationId) => integrations.find((item) => item.id === id);
  const sortedProtocols = [...OPTIONAL_PROTOCOLS].sort((left, right) => {
    const score = (id: IntegrationId) => status(id)?.status === "ready" ? 0 : status(id)?.configured ? 1 : 2;
    return score(left.id) - score(right.id);
  });

  return <main className="first-run-page">
    <div className="first-run-header"><div className="auth-brand"><span className="brand-mark"><Icon name="ac_unit" size={26} filled /></span><div><strong>CastoriceUI</strong><span>v3.0</span></div></div><Chip staticChip tone="warning" icon="checklist">{t("首次初始化", "First-run setup")}</Chip></div>
    <section className="first-run-content">
      <header><p>{t("开始使用前", "Before you begin")}</p><h1>{t("确认真实数据接入", "Confirm live data integrations")}</h1><span>{t("完成节点与流量配置后才能进入总览；未接入的协议会明确显示为未配置。", "Configure the node and traffic quota before opening the dashboard. Protocols without an adapter remain clearly unconfigured.")}</span></header>
      <div className="first-run-steps" aria-label={t("初始化进度", "Setup progress")}><span className="is-done"><b><Icon name="check" size={17} /></b>{t("管理员", "Administrator")}</span><span className={saved ? "is-done" : "is-current"}><b>{saved ? <Icon name="check" size={17} /> : 2}</b>{t("基础设置", "Basics")}</span><span className={saved ? "is-current" : ""}><b>3</b>{t("数据源", "Data sources")}</span><span><b>4</b>{t("完成", "Finish")}</span></div>
      <Card variant="outlined"><CardHeader title={t("节点与流量额度", "Node and traffic quota")} />
        <div className="first-run-basics"><label className="field"><span>{t("节点显示名称", "Node display name")}</span><input maxLength={80} value={nodeName} onChange={(event) => { setNodeName(event.target.value); setSaved(false); }} placeholder={t("例如：东京边缘节点", "Example: Tokyo edge")} /></label><label className="field"><span>{t("总流量额度（GB）", "Total traffic quota (GB)")}</span><div className="quota-input-stable"><input type="number" min="1" max="1000000" inputMode="numeric" value={quotaGb} onChange={(event) => { setQuotaGb(event.target.value); setSaved(false); }} /><span>GB</span></div></label><Button icon="save" disabled={busy || !nodeName.trim() || Number(quotaGb) <= 0} onClick={() => void save()}>{saved ? t("已保存", "Saved") : t("保存基础设置", "Save basics")}</Button></div>
      </Card>
      <Card variant="filled"><CardHeader title={t("代理协议", "Proxy protocols")} description={t("只配置服务器实际使用的协议；面板不会为未接入协议生成数据。", "Configure only protocols actually running on the server. The panel never invents data for unconnected protocols.")} />
        <div className="protocol-setup-grid">{sortedProtocols.map((item) => { const state = status(item.id); const ready = state?.status === "ready"; return <button key={item.id} onClick={() => onConfigure(item.id)}><span><Icon name={item.icon} /></span><div><strong>{item.label}</strong><small>{ready ? t("已连接并验证", "Connected and verified") : state?.configured ? t("已配置但当前不可用", "Configured but unavailable") : t("未配置", "Not configured")}</small></div><Chip staticChip tone={ready ? "success" : state?.configured ? "warning" : "default"}>{ready ? t("可用", "Ready") : t("配置", "Configure")}</Chip></button>; })}</div>
      </Card>
      <Card variant="outlined"><CardHeader title={t("其他数据源", "Other data sources")} description={t("网络质量、订阅和告警可以现在配置，也可以稍后在独立初始化向导中完成。", "Network quality, subscriptions, and alerts can be configured now or later from Setup.")} /><div className="first-run-links">{(["network", "subscriptions", "alerts"] as IntegrationId[]).map((id) => <Button key={id} variant="tonal" onClick={() => onConfigure(id)}>{id === "network" ? t("网络质量", "Network quality") : id === "subscriptions" ? t("订阅记录", "Subscriptions") : t("告警阈值", "Alert thresholds")}</Button>)}</div></Card>
      <div className="first-run-complete"><div><strong>{t("不会写入示例数据", "No sample data is written")}</strong><span>{t("进入总览后，所有数值只来自已验证后端或明确标记的停止更新快照。", "After setup, every value comes from the verified backend or a clearly marked stale snapshot.")}</span></div><Button trailingIcon="arrow_forward" disabled={!saved || busy} onClick={() => void complete()}>{t("完成并进入总览", "Finish and open dashboard")}</Button></div>
    </section>
  </main>;
}
