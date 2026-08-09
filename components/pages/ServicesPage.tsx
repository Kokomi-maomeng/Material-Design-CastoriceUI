"use client";

import type { ServiceStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function ServicesPage({ services, onToast }: { services: ServiceStatus[]; onToast: (message: string) => void }) {
  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="运行状态" title="服务状态" description="集中查看代理核心、系统组件、证书和更新状态。" actions={<Button variant="tonal" icon="refresh" onClick={() => onToast("演示服务状态已重新检查")}>重新检查</Button>} />
      <div className="status-banner status-banner--success"><span><Icon name="check_circle" size={30} filled /></span><div><strong>系统运行正常</strong><p>6 个受监控组件中，5 个正常运行，1 个需要关注。上次检查：刚刚</p></div><Chip staticChip tone="success">可用率 99.98%</Chip></div>
      <section className="service-card-grid">
        {services.map((service) => (
          <Card variant="outlined" className="service-card" key={service.id}>
            <div className="service-card__top"><span className={`service-icon service-icon--${service.status}`}><Icon name={service.icon} size={25} /></span><Chip staticChip tone={service.status === "running" ? "success" : service.status === "warning" ? "warning" : "danger"}>{service.status === "running" ? "运行中" : service.status === "warning" ? "需关注" : "已停止"}</Chip></div>
            <div className="service-card__body"><h3>{service.name}</h3><p>{service.detail}</p></div>
            <dl><div><dt>版本</dt><dd>{service.version}</dd></div><div><dt>运行时间</dt><dd>{service.uptime}</dd></div></dl>
            <div className="service-card__actions"><Button variant="text" compact icon="article" onClick={() => onToast(`${service.name} 日志需要后端脱敏后返回`)}>查看日志</Button><Button variant="text" compact icon="more_vert" aria-label={`更多 ${service.name} 操作`} onClick={() => onToast(`${service.name} 管理操作需要后端授权`)} /></div>
          </Card>
        ))}
      </section>
      <section className="content-grid content-grid--services-bottom">
        <Card variant="filled"><CardHeader title="主机信息" description="Debian 13 · x86_64" /><div className="host-info"><div><span>系统运行时间</span><b>18天 04:23:17</b></div><div><span>系统负载</span><b>0.42 / 0.36 / 0.31</b></div><div><span>内核版本</span><b>Linux 6.12.x</b></div><div><span>时区</span><b>Asia/Tokyo (UTC+9)</b></div></div></Card>
        <Card variant="outlined"><CardHeader title="存储与日志" description="最近 24 小时" /><div className="storage-list"><div><span><b>根分区</b><small>3.6 GB / 20 GB</small></span><Progress value={18} /></div><div><span><b>系统日志</b><small>24.8 MB / 256 MB</small></span><Progress value={9.7} tone="success" /></div><div><span><b>审计记录</b><small>8.2 MB / 128 MB</small></span><Progress value={6.4} tone="success" /></div></div></Card>
      </section>
    </div>
  );
}
