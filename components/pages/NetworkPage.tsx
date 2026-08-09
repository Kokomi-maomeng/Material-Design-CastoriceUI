"use client";

import { useMemo, useState } from "react";
import type { NetworkTarget } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function NetworkPage({ targets, onToast }: { targets: NetworkTarget[]; onToast: (message: string) => void }) {
  const [version, setVersion] = useState<"all" | 4 | 6>("all");
  const filtered = useMemo(() => targets.filter((target) => version === "all" || target.ipVersion === version), [targets, version]);
  const avgLatency = filtered.reduce((sum, item) => sum + item.latency, 0) / filtered.length;
  const avgJitter = filtered.reduce((sum, item) => sum + item.jitter, 0) / filtered.length;
  const avgLoss = filtered.reduce((sum, item) => sum + item.loss, 0) / filtered.length;

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="链路可观测性" title="网络质量" description="持续观测常用大厂与自定义目标的延迟、抖动和丢包。" actions={<><Button variant="outlined" icon="add" onClick={() => onToast("探测目标需要由后端校验并保存")}>添加目标</Button><Button variant="tonal" icon="refresh" onClick={() => onToast("演示探测结果已刷新")}>立即探测</Button></>} />
      <div className="network-overview">
        <Card variant="elevated" className="network-score-card"><div className="network-grade"><span>A</span></div><div><small>综合质量</small><strong>优秀</strong><p>IPv4 与 IPv6 路径整体稳定</p></div></Card>
        <NetworkMetric icon="timer" label="平均延迟" value={`${avgLatency.toFixed(1)} ms`} state="较低" />
        <NetworkMetric icon="ssid_chart" label="平均抖动" value={`${avgJitter.toFixed(1)} ms`} state="稳定" />
        <NetworkMetric icon="packet_mirror" label="平均丢包" value={`${avgLoss.toFixed(2)}%`} state={avgLoss > 1 ? "需关注" : "正常"} />
      </div>

      <Card variant="outlined" className="network-panel">
        <CardHeader title="目标节点" description="最近一次探测 · 10 秒采样窗口" action={<div className="segmented-control"><button className={version === "all" ? "is-selected" : ""} onClick={() => setVersion("all")}>全部</button><button className={version === 4 ? "is-selected" : ""} onClick={() => setVersion(4)}>IPv4</button><button className={version === 6 ? "is-selected" : ""} onClick={() => setVersion(6)}>IPv6</button></div>} />
        <div className="network-target-list">
          {filtered.map((target) => (
            <div className="network-target" key={target.id}>
              <div className="provider-mark">{target.name.slice(0, 1)}</div>
              <div className="network-target__identity"><strong>{target.name}</strong><span>{target.address} · IPv{target.ipVersion}</span></div>
              <div className="sparkline" aria-label={`${target.name} 延迟趋势`}><Sparkline values={target.history} degraded={target.status === "degraded"} /></div>
              <div className="network-measure"><span>延迟</span><b>{target.latency.toFixed(1)} ms</b></div>
              <div className="network-measure"><span>抖动</span><b>{target.jitter.toFixed(1)} ms</b></div>
              <div className="network-measure"><span>丢包</span><b className={target.loss > 1 ? "text-warning" : ""}>{target.loss.toFixed(1)}%</b></div>
              <Chip staticChip tone={target.status === "healthy" ? "success" : target.status === "degraded" ? "warning" : "danger"}>{target.status === "healthy" ? "正常" : target.status === "degraded" ? "波动" : "不可达"}</Chip>
              <Button variant="text" icon="more_vert" aria-label={`管理 ${target.name}`} onClick={() => onToast(`${target.name} 的配置需要后端授权`)} />
            </div>
          ))}
        </div>
      </Card>

      <Card variant="filled" className="network-note"><Icon name="info" size={22} /><div><strong>如何读取这些指标？</strong><span>延迟反映响应时间；抖动反映延迟稳定性；丢包会直接影响视频、游戏和 QUIC。面板不会运行大流量测速，以免消耗月度额度。</span></div></Card>
    </div>
  );
}

function NetworkMetric({ icon, label, value, state }: { icon: string; label: string; value: string; state: string }) { return <Card variant="filled" className="network-metric"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><em>{state}</em></div></Card>; }

function Sparkline({ values, degraded }: { values: number[]; degraded: boolean }) {
  const max = Math.max(...values); const min = Math.min(...values); const range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / range) * 24}`).join(" ");
  return <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke={degraded ? "var(--warning)" : "var(--primary)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
