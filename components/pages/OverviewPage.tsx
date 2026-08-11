"use client";

import { useState } from "react";

import { formatBytes, percent } from "../../lib/format";
import type { Connection, DashboardPayload, NetworkTarget, OverviewMetrics, ServiceStatus, TrafficRange } from "../../lib/types";
import { TrafficChart } from "../charts/TrafficChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function OverviewPage({
  mode,
  metrics,
  connections,
  services,
  networkTargets,
  traffic,
  onEditQuota,
  onRefresh,
  onViewServices,
}: {
  mode: "loading" | "live" | "preview" | "stale";
  metrics: OverviewMetrics;
  connections: Connection[];
  services: ServiceStatus[];
  networkTargets: NetworkTarget[];
  traffic: DashboardPayload["traffic"];
  onEditQuota: () => void;
  onRefresh: () => void;
  onViewServices: () => void;
}) {
  const [trafficRange, setTrafficRange] = useState<TrafficRange>("24h");
  const preview = mode === "preview";
  const stale = mode === "stale";
  const usage = percent(metrics.trafficUsedBytes, metrics.trafficLimitBytes);
  const connectionRatesAvailable = connections.length > 0 && connections.every((item) => item.downloadBps !== null && item.uploadBps !== null);
  const totalDown = connectionRatesAvailable ? connections.reduce((sum, item) => sum + (item.downloadBps ?? 0), 0) : metrics.downloadBps;
  const totalUp = connectionRatesAvailable ? connections.reduce((sum, item) => sum + (item.uploadBps ?? 0), 0) : metrics.uploadBps;
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
        title={metrics.nodeName}
        description={preview ? "当前展示内置示例数据，用于体验布局和交互；没有连接任何服务器。" : stale ? "当前是最后一次成功快照，后端连接已中断；这些值不是当前实时状态。" : "服务器资源来自后端当前快照；协议与网络字段按各数据源实际能力展示。"}
        actions={<Button variant="tonal" icon="refresh" onClick={onRefresh}>刷新数据</Button>}
      />

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

        <MetricCard icon="memory" label="CPU" value={`${metrics.cpuPercent.toFixed(0)}%`} detail={`${metrics.cpuCores} 核 · 负载 ${metrics.load[0] ?? 0}`} trend={preview ? "演示" : metrics.cpuPercent < 80 ? "稳定" : "繁忙"} />
        <MetricCard icon="memory_alt" label="内存" value={`${metrics.memoryPercent.toFixed(0)}%`} detail={`${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`} trend={preview ? "演示" : metrics.memoryPercent < 85 ? "正常" : "偏高"} />
        <MetricCard icon="hard_drive" label="磁盘" value={`${metrics.diskPercent.toFixed(0)}%`} detail={`${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`} trend={preview ? "演示" : metrics.diskPercent < 85 ? "正常" : "偏高"} />
      </section>

      <section className="content-grid content-grid--dashboard">
        <Card className="resource-panel" variant="outlined">
          <CardHeader
            title="近期进出流量"
            description={preview ? "示例趋势 · 不代表真实采样" : "主网卡累计计数器的相邻采样增量"}
            action={<RangeControl value={trafficRange} onChange={setTrafficRange} />}
          />
          <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />下载<span className="dot dot--secondary" />上传</div>
          <TrafficChart data={(traffic.ranges?.[trafficRange] ?? []).map((item) => ({ ...item, upload: item.upload / 1024 ** 3, download: item.download / 1024 ** 3 }))} />
        </Card>

        <Card className="live-summary" variant="filled">
          <CardHeader title={preview ? "连接数据示例" : "协议连接快照"} description={preview ? "用于演示列表与速率布局" : stale ? "后端中断前的最后一次成功快照" : "每 5 秒刷新；字段取决于协议核心"} action={<Chip staticChip tone={preview ? "default" : stale ? "warning" : "success"} icon={preview ? "science" : stale ? "cloud_off" : "schedule"}>{preview ? "演示" : stale ? "已停止更新" : "快照"}</Chip>} />
          <div className="live-speed">
            <div><span><Icon name="download" size={18} />{connectionRatesAvailable ? "连接下载" : `主网卡 ${metrics.interface} 下载`}</span><strong>{formatBytes(totalDown)}<small>/s</small></strong></div>
            <div><span><Icon name="upload" size={18} />{connectionRatesAvailable ? "连接上传" : `主网卡 ${metrics.interface} 上传`}</span><strong>{formatBytes(totalUp)}<small>/s</small></strong></div>
          </div>
          <div className="live-meta">
            <span><b>{connections.length}</b> 活动连接条目</span>
            <span><b>{onlineAccounts}</b> 活跃账号</span>
            <span><b>{connections.reduce((sum, item) => sum + item.connections, 0)}</b> 并发连接</span>
          </div>
        </Card>
      </section>

      <section className="content-grid content-grid--dashboard-bottom">
        <Card variant="outlined">
          <CardHeader title={preview ? "服务状态示例" : "服务健康度"} description={preview ? "以下状态均为虚构演示" : "核心组件与证书状态"} action={<Button variant="text" compact trailingIcon="arrow_forward" onClick={onViewServices}>查看全部</Button>} />
          <div className="service-compact-list">
            {services.slice(0, 4).map((service) => (
              <div className="service-compact" key={service.id}>
                <span className={`service-icon service-icon--${service.status}`}><Icon name={service.icon} /></span>
                <div><strong>{service.name}</strong><span>{service.detail}</span></div>
                <Chip staticChip tone={preview ? "default" : service.status === "running" ? "success" : "warning"}>{preview ? "演示" : service.status === "running" ? "运行中" : "需关注"}</Chip>
              </div>
            ))}
          </div>
        </Card>

        <Card variant="filled" className="quality-card">
          <CardHeader title={preview ? "网络质量示例" : "网络质量"} description={preview ? "虚构 IPv4 / IPv6 观测数据" : "探测结果最多缓存 5 分钟；不是 5 秒实时探测"} />
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

function RangeControl({ value, onChange }: { value: TrafficRange; onChange: (value: TrafficRange) => void }) {
  return <div className="segmented-control traffic-range-control">{(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => <button key={item} className={value === item ? "is-selected" : ""} onClick={() => onChange(item)}>{item === "3day" ? "3天" : item === "7day" ? "7天" : item}</button>)}</div>;
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
