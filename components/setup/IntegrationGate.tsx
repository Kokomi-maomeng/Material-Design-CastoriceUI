import type { IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { useI18n } from "../../lib/i18n";

export function IntegrationGate({
  status,
  name,
  nameEn = name,
  description,
  descriptionEn = description,
  onConfigure,
}: {
  status?: IntegrationStatus;
  name: string;
  nameEn?: string;
  description: string;
  descriptionEn?: string;
  onConfigure: () => void;
}) {
  const { t } = useI18n();
  const label = t(name, nameEn);
  const fallback = t(description, descriptionEn);
  const summary = status
    ? t(
        status.summaryZh || status.summary || fallback,
        status.summaryEn || status.summary || fallback,
      )
    : fallback;
  if (status?.configured && status.status === "ready") {
    return (
      <Card
        variant="filled"
        className="integration-gate integration-gate--ready"
      >
        <span className="integration-gate__icon">
          <Icon name="check_circle" filled />
        </span>
        <div>
          <strong>{t(`${label} 可用`, `${label} ready`)}</strong>
          <p>{summary}</p>
        </div>
        <Chip staticChip tone="success">
          {t("运行态正常", "Runtime healthy")}
        </Chip>
      </Card>
    );
  }
  if (status?.configured && status.status === "error") {
    return (
      <Card variant="filled" className="integration-gate">
        <span className="integration-gate__icon">
          <Icon name="error" filled />
        </span>
        <div>
          <strong>
            {t(
              `${label} 已配置但当前不可用`,
              `${label} configured but unavailable`,
            )}
          </strong>
          <p>{summary}</p>
        </div>
        <Button variant="tonal" compact icon="settings" onClick={onConfigure}>
          {t("检查配置", "Check configuration")}
        </Button>
      </Card>
    );
  }
  return (
    <Card variant="outlined" className="integration-gate">
      <span className="integration-gate__icon">
        <Icon name="power_settings_new" />
      </span>
      <div>
        <strong>{t(`${label} 尚未开启`, `${label} is not configured`)}</strong>
        <p>{fallback}</p>
      </div>
      <div className="integration-gate__actions">
        <button
          className="md-switch"
          role="switch"
          aria-checked="false"
          aria-label={t(`开启 ${label}`, `Configure ${label}`)}
          onClick={onConfigure}
        >
          <span />
        </button>
        <Button variant="tonal" compact icon="settings" onClick={onConfigure}>
          {t("开始配置", "Configure")}
        </Button>
      </div>
    </Card>
  );
}
