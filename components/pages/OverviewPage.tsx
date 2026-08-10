"use client";

import { formatBytes, percent } from "../../lib/format";
import type { Connection, IntegrationId, IntegrationStatus, NetworkTarget, OverviewMetrics, ServiceStatus } from "../../lib/types";
import { ResourceChart } from "../charts/ResourceChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";
import { SetupPanel } from "../setup/SetupPanel";

export function OverviewPage({
  metrics,
  connections,
  services,
  networkTargets,
  integrations,
  resourceHistory,
  showSetup,
  onOpenSetup,
  onEditQuota,
  onRefresh,
  onViewServices,
}: {
  metrics: OverviewMetrics;
  connections: Connection[];
  services: ServiceStatus[];
  networkTargets: NetworkTarget[];
  integrations: IntegrationStatus[];
  resourceHistory: Array<{ label: string; cpu: number; memory: number }>;
  showSetup: boolean;
  onOpenSetup: (id: IntegrationId) => void;
  onEditQuota: () => void;
  onRefresh: () => void;
  onViewServices: () => void;
}) {
  const usage = percent(metrics.trafficUsedBytes, metrics.trafficLimitBytes);
  const totalDown = connections.reduce((sum, item) => sum + item.downloadBps, 0) || metrics.downloadBps;
  const totalUp = connections.reduce((sum, item) => sum + item.uploadBps, 0) || metrics.uploadBps;
  const onlineAccounts = new Set(connections.map((item) => item.account)).size;
  const remaining = Math.max(0, metrics.trafficLimitBytes - metrics.trafficUsedBytes);
  const estimatedDays = metrics.trafficUsedBytes > 0 ? Math.max(1, Math.round(30 * remaining / metrics.trafficUsedBytes)) : null;
  const reachableTargets = networkTargets.filter((target) => target.status !== "down").length;
  const averageLatency = networkTargets.length ? networkTargets.reduce((sum, target) => sum + target.latency, 0) / networkTargets.length : 0;
  const averageLoss = networkTargets.length ? networkTargets.reduce((sum, target) => sum + target.loss, 0) / networkTargets.length : 0;
  const networkGrade = networkTargets.length === 0 ? "暂无数据" : averageLoss >= 5 || averageLatency >= 150 ? "较差" : averageLoss >= 1 || averageLatency >= 80 ? "一般" : "优秀";

  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow={metrics.nodeRegion}
        title={metrics.nodeName}
        description="服务器资源、协议连接和网络质量来自后端实时采集。"
        actions={<Button variant="tonal" icon="refresh" onClick={onRefresh}>刷新数据</Button>}
      />

      {showSetup ? <SetupPanel statuses={integrations} onOpen={onOpenSetup} /> : null}

      <section className="overview-hero-grid" aria-label="关键运行指标">
        <Card className="traffic-hero" variant="elevated">
          <div className="traffic-hero__top">
            <div>
              <span className="metric-label">本周期流量</span>
              <strong>{formatBytes(metrics.trafficUsedBytes)}</strong>
              <span className="metric-support">共 {formatBytes(metrics.trafficLimitBytes)} · 剩余 {formatBytes(remaining)}</span>
            </div>
            <Button variant="text" icon="edit" aria-label="修改总流量" onClick={onEditQuota} />
          </div>
          <Progress value={usage} tone={usage >= 90 ? "danger" : usage >= 75 ? "warning" : "primary"} label="月度流量使用率" />
          <div className="traffic-hero__footer">
            <span><Icon name="calendar_month" size={18} /> {estimatedDays ? `按当前均值约 ${estimatedDays} 天` : "正在建立用量基线"}</span>
            <Chip staticChip tone="warning">已用 {usage.toFixed(0)}%</Chip>
          </div>
        </Card>

        <MetricCard icon="memory" label="CPU" value={`${metrics.cpuPercent.toFixed(0)}%`} detail={`${metrics.cpuCores} 核 · 负载 ${metrics.load[0] ?? 0}`} trend={metrics.cpuPercent < 80 ? "稳定" : "繁忙"} />
        <MetricCard icon="memory_alt" label="内存" value={`${metrics.memoryPercent.toFixed(0)}%`} detail={`${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`} trend={metrics.memoryPercent < 85 ? "正常" : "偏高"} />
        <MetricCard icon="hard_drive" label="磁盘" value={`${metrics.diskPercent.toFixed(0)}%`} detail={`${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`} trend={metrics.diskPercent < 85 ? "正常" : "偏高"} />
      </section>

      <section className="content-grid content-grid--dashboard">
        <Card className="resource-panel" variant="outlined">
          <CardHeader
            title="系统资源"
            description="最近 30 分钟 · 后端持续采样"
            action={<div className="legend-inline"><span className="dot dot--primary" />CPU<span className="dot dot--tertiary" />内存</div>}
          />
          <ResourceChart data={resourceHistory} />
        </Card>

        <Card className="live-summary" variant="filled">
          <CardHeader title="实时连接" description="过去 3 秒内活跃" action={<Chip staticChip tone="success" icon="fiber_manual_record">实时</Chip>} />
          <div className="live-speed">
            <div><span><Icon name="download" size={18} />下载</span><strong>{formatBytes(totalDown)}<small>/s</small></strong></div>
            <div><span><Icon name="upload" size={18} />上传</span><strong>{formatBytes(totalUp)}<small>/s</small></strong></div>
          </div>
          <div className="live-meta">
            <span><b>{connections.length}</b> 在线设备</span>
            <span><b>{onlineAccounts}</b> 活跃账号</span>
            <span><b>{connections.reduce((sum, item) => sum + item.connections, 0)}</b> 并发连接</span>
          </div>
        </Card>
      </section>

      <section className="content-grid content-grid--dashboard-bottom">
        <Card variant="outlined">
          <CardHeader title="服务健康度" description="核心组件与证书状态" action={<Button variant="text" compact trailingIcon="arrow_forward" onClick={onViewServices}>查看全部</Button>} />
          <div className="service-compact-list">
            {services.slice(0, 4).map((service) => (
              <div className="service-compact" key={service.id}>
                <span className={`service-icon service-icon--${service.status}`}><Icon name={service.icon} /></span>
                <div><strong>{service.name}</strong><span>{service.detail}</span></div>
                <Chip staticChip tone={service.status === "running" ? "success" : "warning"}>{service.status === "running" ? "运行中" : "需关注"}</Chip>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="filled" className="quality-card">
          <CardHeader title="网络质量" description="IPv4 / IPv6 综合观测" />
          <div className="quality-summary"><span><Icon name="verified" size={26} /></span><div><small>当前质量等级</small><strong>{networkGrade}</strong><em>{reachableTargets} / {networkTargets.length} 个目标可达</em></div></div>
          <div className="quality-bars">
            <div><span>平均延迟</span><b>{networkTargets.length ? `${averageLatency.toFixed(1)} ms` : "等待探测"}</b><Progress value={networkTargets.length ? Math.max(0, 100 - averageLatency / 2) : 0} tone={networkTargets.length && averageLatency < 80 ? "success" : "warning"} /></div>
            <div><span>平均丢包</span><b>{networkTargets.length ? `${averageLoss.toFixed(1)}%` : "等待探测"}</b><Progress value={networkTargets.length ? Math.max(0, 100 - averageLoss * 10) : 0} tone={networkTargets.length && averageLoss < 1 ? "success" : "warning"} /></div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, trend }: { icon: string; label: string; value: string; detail: string; trend: string }) {
  return (
    <Card className="metric-card" variant="filled">
      <div className="metric-card__icon"><Icon name={icon} size={24} /></div>
      <div className="metric-card__body"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
      <Chip staticChip>{trend}</Chip>
    </Card>
  );
}
