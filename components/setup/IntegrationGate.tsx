import type { IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";

export function IntegrationGate({ status, name, description, onConfigure }: { status?: IntegrationStatus; name: string; description: string; onConfigure: () => void }) {
  if (status?.configured) {
    return (
      <Card variant="filled" className="integration-gate integration-gate--ready">
        <span className="integration-gate__icon"><Icon name="check_circle" filled /></span>
        <div><strong>{name} 已接入</strong><p>{status.summary || description}</p></div>
        <Chip staticChip tone="success">实时数据</Chip>
      </Card>
    );
  }
  return (
    <Card variant="outlined" className="integration-gate">
      <span className="integration-gate__icon"><Icon name="power_settings_new" /></span>
      <div><strong>{name} 尚未开启</strong><p>{description}</p></div>
      <div className="integration-gate__actions">
        <button className="md-switch" role="switch" aria-checked="false" aria-label={`开启 ${name}`} onClick={onConfigure}><span /></button>
        <Button variant="tonal" compact icon="settings" onClick={onConfigure}>开始配置</Button>
      </div>
    </Card>
  );
}
