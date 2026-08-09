"use client";

import { resourceHistory } from "../../lib/demo-data";
import { formatBytes, percent } from "../../lib/format";
import type { Connection, ServiceStatus } from "../../lib/types";
import { ResourceChart } from "../charts/ResourceChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function OverviewPage({
  trafficUsed,
  trafficLimit,
  connections,
  services,
  onEditQuota,
  onRefresh,
  onViewServices,
}: {
  trafficUsed: number;
  trafficLimit: number;
  connections: Connection[];
  services: ServiceStatus[];
  onEditQuota: () => void;
  onRefresh: () => void;
  onViewServices: () => void;
}) {
  const usage = percent(trafficUsed, trafficLimit);
  const totalDown = connections.reduce((sum, item) => sum + item.downloadBps, 0);
  const totalUp = connections.reduce((sum, item) => sum + item.uploadBps, 0);
  const onlineAccounts = new Set(connections.map((item) => item.account)).size;

  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow="东京节点 · NRT"
        title="晚上好，Castorice"
        description="所有核心服务正常运行，过去 24 小时网络整体稳定。"
        actions={<Button variant="tonal" icon="refresh" onClick={onRefresh}>刷新数据</Button>}
      />

      <section className="overview-hero-grid" aria-label="关键运行指标">
        <Card className="traffic-hero" variant="elevated">
          <div className="traffic-hero__top">
            <div>
              <span className="metric-label">本周期流量</span>
              <strong>{formatBytes(trafficUsed)}</strong>
              <span className="metric-support">共 {formatBytes(trafficLimit)} · 剩余 {formatBytes(trafficLimit - trafficUsed)}</span>
            </div>
            <Button variant="text" icon="edit" aria-label="修改总流量" onClick={onEditQuota} />
          </div>
          <Progress value={usage} tone={usage >= 90 ? "danger" : usage >= 75 ? "warning" : "primary"} label="月度流量使用率" />
          <div className="traffic-hero__footer">
            <span><Icon name="calendar_month" size={18} /> 9月3日预计耗尽</span>
            <Chip staticChip tone="warning">已用 {usage.toFixed(0)}%</Chip>
          </div>
        </Card>

        <MetricCard icon="memory" label="CPU" value="31%" detail="4 核 · 负载 0.42" trend="稳定" />
        <MetricCard icon="memory_alt" label="内存" value="54%" detail="553 MB / 1 GB" trend="+2%" />
        <MetricCard icon="hard_drive" label="磁盘" value="18%" detail="3.6 GB / 20 GB" trend="正常" />
      </section>

      <section className="content-grid content-grid--dashboard">
        <Card className="resource-panel" variant="outlined">
          <CardHeader
            title="系统资源"
            description="最近 30 分钟 · 每 5 分钟采样"
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
          <div className="quality-score"><strong>96</strong><span>/ 100</span></div>
          <div className="quality-bars">
            <div><span>延迟</span><b>2.8 ms</b><Progress value={92} tone="success" /></div>
            <div><span>抖动</span><b>0.6 ms</b><Progress value={96} tone="success" /></div>
            <div><span>丢包</span><b>0.2%</b><Progress value={88} tone="success" /></div>
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
