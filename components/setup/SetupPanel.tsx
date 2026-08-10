import { integrationDefinitions } from "../../lib/integrations";
import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";

export function SetupPanel({ statuses, onOpen, preview = false }: { statuses: IntegrationStatus[]; onOpen: (id: IntegrationId) => void; preview?: boolean }) {
  const statusMap = new Map(statuses.map((item) => [item.id, item]));
  const pending = integrationDefinitions.filter((item) => !statusMap.get(item.id)?.configured);
  const completed = integrationDefinitions.filter((item) => statusMap.get(item.id)?.configured);
  return (
    <Card variant="outlined" className="setup-panel">
      <CardHeader title={preview ? "初始化向导演示" : "初始化向导"} description={preview ? "你可以体验完整流程，但不会保存配置或验证服务器。" : "按步骤连接数据源；输入内容在本次页面会话内保留，刷新后自动清除。"} action={<Chip staticChip tone={preview ? "default" : pending.length ? "warning" : "success"}>{preview ? "示例数据" : pending.length ? `${pending.length} 项待配置` : "全部完成"}</Chip>} />
      {pending.length ? <div className="setup-list setup-list--pending">{pending.map((item, index) => <button key={item.id} onClick={() => onOpen(item.id)}><span className="setup-order">{index + 1}</span><span className="setup-service-icon"><Icon name={item.icon} /></span><span><strong>{item.name}</strong><small>{item.summary}</small></span><Icon name="chevron_right" /></button>)}</div> : <div className="setup-complete-message"><Icon name="task_alt" filled /><div><strong>{preview ? "界面演示已经完成" : "数据接入已经就绪"}</strong><p>{preview ? "部署后仍需连接并验证真实服务。" : "你仍可从下方已完成列表查看配置目的和验证状态。"}</p></div></div>}
      {completed.length ? <div className="setup-completed"><h3>{preview ? "演示项目" : "已完成"}</h3>{completed.map((item) => <button key={item.id} onClick={() => onOpen(item.id)}><Icon name={preview ? "science" : "check_circle"} filled /><span><strong>{item.name}</strong><small>{preview ? `${item.name} 的界面示例，尚未连接真实服务` : statusMap.get(item.id)?.summary || item.outcome}</small></span><Chip staticChip tone={preview ? "default" : "success"}>{preview ? "演示" : "正常"}</Chip></button>)}</div> : null}
    </Card>
  );
}
