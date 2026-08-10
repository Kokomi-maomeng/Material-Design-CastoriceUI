"use client";

import { useMemo, useState } from "react";
import type { AlertItem, IntegrationStatus } from "../../lib/types";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function AlertsPage({ alerts, onAcknowledge, onToast, integration, onConfigure }: { alerts: AlertItem[]; onAcknowledge: (id: string) => void; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [filter, setFilter] = useState<"active" | "all">("active");
  const visible = useMemo(() => alerts.filter((item) => filter === "all" || !item.acknowledged), [alerts, filter]);
  const unacknowledged = alerts.filter((item) => !item.acknowledged).length;
  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="主动监控" title="告警中心" description="在流量、服务、链路或证书出现风险时及时提醒。" actions={<Button variant="outlined" icon="tune" onClick={() => onToast("告警规则需要由后端持久化")}>告警规则</Button>} />
      <IntegrationGate status={integration} name="告警规则" description="设置流量、延迟、丢包和证书阈值后，异常会自动进入待处理列表。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "notifications_active", title: "统一事件", description: "汇总流量、服务、网络和证书风险。" }, { icon: "rule", title: "阈值清晰", description: "每条告警展示触发来源与判断依据。" }, { icon: "done_all", title: "确认闭环", description: "确认状态写入后端并保留审计记录。" }]} />
      <section className="alert-summary">
        <Card variant="filled"><span className="alert-count alert-count--critical">{alerts.filter((item) => item.severity === "critical" && !item.acknowledged).length}</span><div><strong>严重</strong><p>需要尽快处理</p></div></Card>
        <Card variant="filled"><span className="alert-count alert-count--warning">{alerts.filter((item) => item.severity === "warning" && !item.acknowledged).length}</span><div><strong>警告</strong><p>建议持续关注</p></div></Card>
        <Card variant="filled"><span className="alert-count alert-count--info">{alerts.filter((item) => item.severity === "info" && !item.acknowledged).length}</span><div><strong>提醒</strong><p>一般信息通知</p></div></Card>
      </section>
      <Card variant="outlined" className="alert-panel">
        <div className="table-toolbar"><div className="filter-chips"><Chip selected={filter === "active"} onClick={() => setFilter("active")}>待处理 {unacknowledged}</Chip><Chip selected={filter === "all"} onClick={() => setFilter("all")}>全部记录</Chip></div><Button variant="text" compact icon="done_all" disabled={unacknowledged === 0} onClick={() => alerts.filter((item) => !item.acknowledged).forEach((item) => onAcknowledge(item.id))}>全部确认</Button></div>
        <div className="alert-list">
          {visible.map((alert) => <div className={`alert-row alert-row--${alert.severity} ${alert.acknowledged ? "is-acknowledged" : ""}`} key={alert.id}><span className="alert-row__icon"><Icon name={alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warning" : "info"} size={23} filled /></span><div className="alert-row__content"><div><strong>{alert.title}</strong><Chip staticChip>{alert.source}</Chip></div><p>{alert.description}</p><span>{alert.time}</span></div><div className="alert-row__actions">{!alert.acknowledged ? <Button variant="tonal" compact onClick={() => onAcknowledge(alert.id)}>确认</Button> : <Chip staticChip tone="success" icon="check">已确认</Chip>}<Button variant="text" icon="more_vert" aria-label={`管理告警：${alert.title}`} onClick={() => onToast("告警详情需要后端事件数据")} /></div></div>)}
        </div>
      </Card>
    </div>
  );
}
