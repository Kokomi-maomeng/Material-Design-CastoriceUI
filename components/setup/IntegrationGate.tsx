import type { IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";

export function IntegrationGate({ status, name, description, onConfigure }: { status?: IntegrationStatus; name: string; description: string; onConfigure: () => void }) {
  if (status?.status === "preview") {
    return (
      <Card variant="outlined" className="integration-gate">
        <span className="integration-gate__icon"><Icon name="science" /></span>
        <div><strong>{name} 界面演示</strong><p>{status.summary || description}</p></div>
        <Chip staticChip>非真实数据</Chip>
      </Card>
    );
  }
  if (status?.configured && status.status === "ready") {
    return (
      <Card variant="filled" className="integration-gate integration-gate--ready">
        <span className="integration-gate__icon"><Icon name="check_circle" filled /></span>
        <div><strong>{name} 可用</strong><p>{status.summary || description}</p></div>
        <Chip staticChip tone="success">运行态正常</Chip>
      </Card>
    );
  }
  if (status?.configured && status.status === "error") {
    return (
      <Card variant="filled" className="integration-gate">
        <span className="integration-gate__icon"><Icon name="error" filled /></span>
        <div><strong>{name} 已配置但当前不可用</strong><p>{status.summary || description}</p></div>
        <Button variant="tonal" compact icon="settings" onClick={onConfigure}>检查配置</Button>
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
