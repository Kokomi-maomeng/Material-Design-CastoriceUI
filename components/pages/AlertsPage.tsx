"use client";

import { useMemo, useState } from "react";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";
import type { AlertItem, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function AlertsPage({
  alerts,
  onAcknowledge,
  integration,
  onConfigure,
}: {
  alerts: AlertItem[];
  onAcknowledge: (id: string) => Promise<void>;
  onToast: (message: string) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
}) {
  const { language, t } = useI18n();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const visible = useMemo(
    () => alerts.filter((item) => filter === "all" || !item.acknowledged),
    [alerts, filter],
  );
  const unacknowledged = alerts.filter((item) => !item.acknowledged).length;
  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow={t("主动监控", "Proactive monitoring")}
        title={t("告警中心", "Alerts")}
        description={t(
          "在真实流量、服务、链路或证书出现风险时提醒。",
          "Receive alerts when real traffic, services, links, or certificates show risk.",
        )}
      />
      <IntegrationGate
        status={integration}
        name="告警规则"
        nameEn="Alert rules"
        description="设置流量、延迟和丢包阈值后，异常会自动进入待处理列表。"
        descriptionEn="Set traffic, latency, and packet-loss thresholds to place real anomalies in the active list."
        onConfigure={onConfigure}
      />
      <section className="alert-summary">
        <Card variant="filled">
          <span className="alert-count alert-count--critical">
            {
              alerts.filter(
                (item) => item.severity === "critical" && !item.acknowledged,
              ).length
            }
          </span>
          <div>
            <strong>{t("严重", "Critical")}</strong>
          </div>
        </Card>
        <Card variant="filled">
          <span className="alert-count alert-count--warning">
            {
              alerts.filter(
                (item) => item.severity === "warning" && !item.acknowledged,
              ).length
            }
          </span>
          <div>
            <strong>{t("警告", "Warning")}</strong>
          </div>
        </Card>
        <Card variant="filled">
          <span className="alert-count alert-count--info">
            {
              alerts.filter(
                (item) => item.severity === "info" && !item.acknowledged,
              ).length
            }
          </span>
          <div>
            <strong>{t("提醒", "Info")}</strong>
          </div>
        </Card>
      </section>
      <Card variant="outlined" className="alert-panel">
        <div className="table-toolbar">
          <div className="filter-chips">
            <Chip
              selected={filter === "active"}
              onClick={() => setFilter("active")}
            >
              {t("待处理", "Active")} {unacknowledged}
            </Chip>
            <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
              {t("全部记录", "All records")}
            </Chip>
          </div>
          <Button
            variant="text"
            compact
            icon="done_all"
            disabled={unacknowledged === 0}
            onClick={() =>
              alerts
                .filter((item) => !item.acknowledged)
                .forEach((item) => void onAcknowledge(item.id))
            }
          >
            {t("全部确认", "Acknowledge all")}
          </Button>
        </div>
        <div className="alert-list">
          {visible.map((alert) => (
            <div
              className={`alert-row alert-row--${alert.severity} ${alert.acknowledged ? "is-acknowledged" : ""}`}
              key={alert.id}
            >
              <span className="alert-row__icon">
                <Icon
                  name={
                    alert.severity === "critical"
                      ? "error"
                      : alert.severity === "warning"
                        ? "warning"
                        : "info"
                  }
                  size={23}
                  filled
                />
              </span>
              <div className="alert-row__content">
                <div>
                  <strong>
                    {language === "zh"
                      ? alert.titleZh || alert.title
                      : alert.titleEn || alert.title}
                  </strong>
                  <Chip staticChip>
                    {language === "zh"
                      ? alert.sourceZh || alert.source
                      : alert.sourceEn || alert.source}
                  </Chip>
                </div>
                <p>
                  {withoutTerminalPeriod(
                    language === "zh"
                      ? alert.descriptionZh || alert.description
                      : alert.descriptionEn || alert.description,
                  )}
                </p>
                <span>
                  {language === "zh"
                    ? alert.timeZh || alert.time
                    : alert.timeEn || alert.time}
                </span>
              </div>
              <div className="alert-row__actions">
                {!alert.acknowledged ? (
                  <Button
                    variant="tonal"
                    compact
                    onClick={() => void onAcknowledge(alert.id)}
                  >
                    {t("确认", "Acknowledge")}
                  </Button>
                ) : (
                  <Chip staticChip tone="success" icon="check">
                    {t("已确认", "Acknowledged")}
                  </Chip>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
