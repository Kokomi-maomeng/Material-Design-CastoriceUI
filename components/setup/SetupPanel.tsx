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
  return (
    <Card variant="outlined" className="setup-panel">
      <CardHeader
        title={t("初始化向导", "Setup")}
        action={!pending.length ? (
          <Chip staticChip tone={pending.length ? "warning" : "success"}>
            {t("全部完成", "All complete")}
          </Chip>
        ) : undefined}
      />
      {completed.length ? (
        <div className="setup-completed setup-completed--first">
          <h3>{t("已完成", "Completed")}</h3>
          {completed.map((item) => {
            const isReady = statusMap.get(item.id)?.status === "ready";
            return (
            <button key={item.id} onClick={() => onOpen(item.id)}>
              <Icon name={isReady ? "check_circle" : "error"} filled className={isReady ? "setup-status-icon--ready" : "setup-status-icon--error"} />
              <span>
                <strong>{local(item.name)}</strong>
              </span>
              <Chip staticChip tone={isReady ? "success" : "warning"}>
                {isReady ? t("正常", "Ready") : t("需检查", "Check")}
              </Chip>
            </button>
            );
          })}
        </div>
      ) : null}
      {pending.length ? (
        <div className="setup-pending-heading">
          <h3>{t("待配置", "Pending")}</h3>
          <Chip staticChip tone="warning">
            {t(`${pending.length} 项待配置`, `${pending.length} pending`)}
          </Chip>
        </div>
      ) : null}
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
    </Card>
  );
}
