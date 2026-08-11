import { integrationDefinitions } from "../../lib/integrations";
import { useI18n } from "../../lib/i18n";
import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";

export function SetupPanel({
  statuses,
  onOpen,
}: {
  statuses: IntegrationStatus[];
  onOpen: (id: IntegrationId) => void;
  preview?: boolean;
}) {
  const { language, t } = useI18n();
  const statusMap = new Map(statuses.map((item) => [item.id, item]));
  const pending = integrationDefinitions.filter(
    (item) => !statusMap.get(item.id)?.configured,
  );
  const completed = integrationDefinitions.filter(
    (item) => statusMap.get(item.id)?.configured,
  );
  const local = (value: { zh: string; en: string }) => value[language];
  const runtimeSummary = (
    status: IntegrationStatus | undefined,
    fallback: string,
  ) =>
    status
      ? (language === "zh" ? status.summaryZh : status.summaryEn) ||
        status.summary ||
        fallback
      : fallback;
  return (
    <Card variant="outlined" className="setup-panel">
      <CardHeader
        title={t("初始化向导", "Setup")}
        description={t(
          "按步骤连接真实数据源；未提交内容刷新后自动清除。",
          "Connect live data sources step by step. Unsubmitted values are cleared on refresh.",
        )}
        action={
          <Chip staticChip tone={pending.length ? "warning" : "success"}>
            {pending.length
              ? t(`${pending.length} 项待配置`, `${pending.length} pending`)
              : t("全部完成", "All complete")}
          </Chip>
        }
      />
      {pending.length ? (
        <div className="setup-list setup-list--pending">
          {pending.map((item, index) => (
            <button key={item.id} onClick={() => onOpen(item.id)}>
              <span className="setup-order">{index + 1}</span>
              <span className="setup-service-icon">
                <Icon name={item.icon} />
              </span>
              <span>
                <strong>{local(item.name)}</strong>
                <small>{local(item.summary)}</small>
              </span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      ) : (
        <div className="setup-complete-message">
          <Icon name="task_alt" filled />
          <div>
            <strong>
              {t("数据接入已经就绪", "Data integrations are ready")}
            </strong>
            <p>
              {t(
                "仍可从下方查看配置目的和当前验证状态。",
                "You can still review purpose and verification status below.",
              )}
            </p>
          </div>
        </div>
      )}
      {completed.length ? (
        <div className="setup-completed">
          <h3>{t("已完成", "Completed")}</h3>
          {completed.map((item) => (
            <button key={item.id} onClick={() => onOpen(item.id)}>
              <Icon name="check_circle" filled />
              <span>
                <strong>{local(item.name)}</strong>
                <small>
                  {runtimeSummary(statusMap.get(item.id), local(item.outcome))}
                </small>
              </span>
              <Chip staticChip tone="success">
                {t("正常", "Ready")}
              </Chip>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
