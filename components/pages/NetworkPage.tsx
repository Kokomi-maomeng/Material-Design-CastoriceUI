"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import { updateNetworkTargets } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { IntegrationStatus, NetworkTarget } from "../../lib/types";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

interface TargetDraft {
  name: string;
  address: string;
  order: number;
}

export function NetworkPage({
  targets,
  onToast,
  integration,
  onConfigure,
  onSaved,
}: {
  targets: NetworkTarget[];
  onToast: (message: string) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [version, setVersion] = useState<"all" | 4 | 6>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<TargetDraft[]>([]);
  const filtered = useMemo(
    () =>
      targets.filter(
        (target) => version === "all" || target.ipVersion === version,
      ),
    [targets, version],
  );
  const avgLatency = filtered.length
    ? filtered.reduce((sum, item) => sum + item.latency, 0) / filtered.length
    : 0;
  const avgJitter = filtered.length
    ? filtered.reduce((sum, item) => sum + item.jitter, 0) / filtered.length
    : 0;
  const avgLoss = filtered.length
    ? filtered.reduce((sum, item) => sum + item.loss, 0) / filtered.length
    : 0;
  const available = filtered.filter(
    (target) => target.status !== "down",
  ).length;
  const quality =
    filtered.length === 0
      ? t("暂无数据", "No data")
      : avgLoss >= 5 || avgLatency >= 150
        ? t("较差", "Poor")
        : avgLoss >= 1 || avgLatency >= 80
          ? t("一般", "Fair")
          : t("优秀", "Excellent");
  const grade =
    filtered.length === 0
      ? "—"
      : avgLoss >= 5 || avgLatency >= 150
        ? "C"
        : avgLoss >= 1 || avgLatency >= 80
          ? "B"
          : "A";
  const openEditor = () => {
    setDrafts(
      targets.map((target, index) => ({
        name: target.name,
        address: target.address,
        order: target.order ?? index + 1,
      })),
    );
    setEditorOpen(true);
  };
  const change = (index: number, key: keyof TargetDraft, value: string) =>
    setDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, [key]: key === "order" ? Number(value) : value }
          : item,
      ),
    );
  const save = async () => {
    setSaving(true);
    try {
      await updateNetworkTargets(drafts);
      await onSaved();
      setEditorOpen(false);
      onToast(t("网络探测目标已保存", "Network probe targets saved"));
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String(error.message)
          : "";
      onToast(
        message ||
          t(
            "目标保存失败，请检查名称和地址",
            "Unable to save targets. Check names and addresses.",
          ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-content page-enter">
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
        description="设置 IPv4 / IPv6 目标后，后端按 5 秒刷新周期计算延迟、抖动和丢包。"
        descriptionEn="After targets are configured, the backend refreshes latency, jitter, and packet loss every five seconds."
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
          value={filtered.length ? `${avgLatency.toFixed(1)} ms` : "—"}
          state={
            filtered.length
              ? t("最近探测", "Latest probe")
              : t("等待探测", "Waiting")
          }
        />
        <NetworkMetric
          icon="ssid_chart"
          label={t("平均抖动", "Average jitter")}
          value={filtered.length ? `${avgJitter.toFixed(1)} ms` : "—"}
          state={filtered.length ? t("真实响应样本", "Real response samples") : t("等待探测", "Waiting")}
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
                <div className="network-target__identity"><strong>{target.name}</strong><span>{target.address} · IPv{target.ipVersion}</span></div>
                <Chip staticChip tone={target.status === "healthy" ? "success" : target.status === "degraded" ? "warning" : "danger"}>
                  {target.status === "healthy" ? t("正常", "Healthy") : target.status === "degraded" ? t("波动", "Degraded") : t("不可达", "Down")}
                </Chip>
              </div>
              <div className="network-target-card__chart">
                <div className="network-target-card__chart-title"><span>{t("延迟趋势", "Latency trend")}</span><b>{target.latency.toFixed(1)} ms</b></div>
                <div className="sparkline" aria-label={t(`${target.name} 延迟趋势`, `${target.name} latency trend`)}>
                  <Sparkline values={target.history} degraded={target.status !== "healthy"} label={t(`${target.name} 延迟趋势`, `${target.name} latency trend`)} />
                </div>
              </div>
              <div className="network-target-card__metrics">
                <div className="network-measure"><span>{t("延迟", "Latency")}</span><b>{target.latency.toFixed(1)} ms</b></div>
                <div className="network-measure"><span>{t("抖动", "Jitter")}</span><b>{target.jitter.toFixed(1)} ms</b></div>
                <div className="network-measure"><span>{t("丢包", "Loss")}</span><b className={target.loss > 1 ? "text-warning" : ""}>{target.loss.toFixed(1)}%</b></div>
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
                { name: "", address: "", order: current.length + 1 },
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
function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const mid = (previous.x + point.x) / 2;
    return `${path} C ${mid},${previous.y} ${mid},${point.y} ${point.x},${point.y}`;
  }, `M ${points[0].x},${points[0].y}`);
}
function Sparkline({
  values,
  degraded,
  label,
}: {
  values: number[];
  degraded: boolean;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const safeValues = values.filter(Number.isFinite);
  const width = 320;
  const height = 148;
  const plot = { left: 16, right: 304, top: 16, bottom: 126 };
  if (safeValues.length === 0)
    return (
      <svg className="network-trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <line
          x1={plot.left}
          y1={(plot.top + plot.bottom) / 2}
          x2={plot.right}
          y2={(plot.top + plot.bottom) / 2}
          stroke="var(--outline)"
          strokeDasharray="4 4"
        />
      </svg>
    );
  const max = Math.max(...safeValues);
  const min = Math.min(...safeValues);
  const range = max - min;
  const points =
    safeValues.length === 1
      ? [{ x: (plot.left + plot.right) / 2, y: (plot.top + plot.bottom) / 2 }]
      : safeValues.map((value, index) => ({
          x: plot.left + (index / (safeValues.length - 1)) * (plot.right - plot.left),
          y: range === 0 ? (plot.top + plot.bottom) / 2 : plot.bottom - ((value - min) / range) * (plot.bottom - plot.top),
        }));
  const stroke = degraded ? "var(--warning)" : "var(--primary)";
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const ratio = Math.max(0, Math.min(1, (cursor.x - plot.left) / (plot.right - plot.left)));
    setActive(Math.round(ratio * (safeValues.length - 1)));
  };
  return (
    <>
    <svg className="sparkline-chart network-trend-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" tabIndex={0} aria-label={label} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive(safeValues.length - 1)} onBlur={() => setActive(null)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity=".2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, .5, 1].map((ratio) => <line key={ratio} className="chart-grid-line" x1={plot.left} x2={plot.right} y1={plot.top + (plot.bottom - plot.top) * ratio} y2={plot.top + (plot.bottom - plot.top) * ratio} />)}
      {points.length > 1 ? <path d={`${smoothPath(points)} L ${plot.right},${plot.bottom} L ${plot.left},${plot.bottom} Z`} fill={`url(#${gradientId})`} /> : null}
      <path
        d={smoothPath(points)}
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point, index) => (
        <g key={index} pointerEvents="none">
          <circle className={`network-trend-point ${active === index ? "is-active" : ""}`} cx={point.x} cy={point.y} r={active === index ? "5" : "3.5"} fill={stroke} />
        </g>
      ))}
      <rect className="sparkline-hit-area" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} />
    </svg>
    {active !== null ? <span className="sparkline-tooltip" style={{ left: `${((points[active].x - plot.left) / (plot.right - plot.left)) * 100}%` }}>{safeValues[Math.min(active, safeValues.length - 1)].toFixed(1)} ms</span> : null}
    </>
  );
}
