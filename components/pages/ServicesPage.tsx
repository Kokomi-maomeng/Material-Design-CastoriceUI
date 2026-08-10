"use client";

import type { IntegrationStatus, OverviewMetrics, ServiceStatus } from "../../lib/types";
import { formatBytes, formatDuration } from "../../lib/format";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function ServicesPage({ services, metrics, onRefresh, integration, onConfigure }: { services: ServiceStatus[]; metrics: OverviewMetrics; onRefresh: () => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const running = services.filter((service) => service.status === "running").length;
  const unhealthy = services.length - running;
  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="运行状态" title="服务状态" description="集中查看代理核心、系统组件、证书和更新状态。" actions={<Button variant="tonal" icon="refresh" onClick={onRefresh}>重新检查</Button>} />
      <IntegrationGate status={integration} name="系统服务监控" description="连接本机 systemd 与证书读取器后，页面会显示真实状态和运行时间。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "dns", title: "核心状态", description: "统一检查 Hysteria2、AnyTLS 和 Nginx。" }, { icon: "verified_user", title: "证书有效期", description: "提前发现证书即将到期或读取异常。" }, { icon: "memory", title: "主机环境", description: "展示内核、负载、运行时间和存储状态。" }]} />
      <div className={`status-banner ${unhealthy ? "status-banner--warning" : "status-banner--success"}`}><span><Icon name={unhealthy ? "warning" : "check_circle"} size={30} filled /></span><div><strong>{unhealthy ? "部分组件需要关注" : "系统运行正常"}</strong><p>{services.length} 个受监控组件中，{running} 个正常运行，{unhealthy} 个需要关注。上次检查：刚刚</p></div><Chip staticChip tone={unhealthy ? "warning" : "success"}>实时检查</Chip></div>
      <section className="service-card-grid">
        {services.map((service) => (
          <Card variant="outlined" className="service-card" key={service.id}>
            <div className="service-card__top"><span className={`service-icon service-icon--${service.status}`}><Icon name={service.icon} size={25} /></span><Chip staticChip tone={service.status === "running" ? "success" : service.status === "warning" ? "warning" : "danger"}>{service.status === "running" ? "运行中" : service.status === "warning" ? "需关注" : "已停止"}</Chip></div>
            <div className="service-card__body"><h3>{service.name}</h3><p>{service.detail}</p></div>
            <dl><div><dt>版本</dt><dd>{service.version}</dd></div><div><dt>运行时间</dt><dd>{service.uptime ?? formatDuration(service.uptimeSeconds ?? 0)}</dd></div></dl>
            <div className="service-card__source"><Icon name="sync" size={17} />由 systemd 与本机程序自动读取</div>
          </Card>
        ))}
      </section>
      <section className="content-grid content-grid--services-bottom">
        <Card variant="filled"><CardHeader title="主机信息" description={metrics.nodeRegion} /><div className="host-info"><div><span>系统运行时间</span><b>{formatDuration(metrics.uptimeSeconds)}</b></div><div><span>系统负载</span><b>{metrics.load.join(" / ")}</b></div><div><span>内核版本</span><b>{metrics.kernel}</b></div><div><span>采集网卡</span><b>{metrics.interface}</b></div></div></Card>
        <Card variant="outlined"><CardHeader title="存储与后端" description="实时读取" /><div className="storage-list"><div><span><b>根分区</b><small>{formatBytes(metrics.diskUsedBytes)} / {formatBytes(metrics.diskTotalBytes)}</small></span><Progress value={metrics.diskPercent} /></div><div><span><b>SQLite 审计</b><small>后端受限目录</small></span><Progress value={100} tone="success" /></div><div><span><b>协议适配器</b><small>{services.filter((item) => item.id === "hysteria2" || item.id === "anytls").filter((item) => item.status === "running").length} / 2 在线</small></span><Progress value={services.filter((item) => item.id === "hysteria2" || item.id === "anytls").filter((item) => item.status === "running").length * 50} tone="success" /></div></div></Card>
      </section>
    </div>
  );
}
