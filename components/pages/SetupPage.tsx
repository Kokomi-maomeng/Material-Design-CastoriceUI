"use client";

import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { SetupPanel } from "../setup/SetupPanel";
import { PageHeader } from "../ui/Page";
import { Card, CardHeader } from "../ui/Card";
import { useI18n } from "../../lib/i18n";

export function SetupPage({ statuses, onOpen }: { statuses: IntegrationStatus[]; onOpen: (id: IntegrationId) => void }) {
  const { t } = useI18n();
  return <div className="page-content page-enter">
    <PageHeader title={t("初始化向导", "Setup")} />
    <Card variant="filled" className="setup-prerequisites"><CardHeader title={t("接入前检查", "Before connecting data sources")} description={t("向导验证真实运行状态；服务器受保护配置仍负责 API Secret、管理账号与订阅记录。未接入的功能会显示待配置或不可用。", "The wizard validates live state. API secrets, managed accounts, and subscription records still belong in protected server configuration. Unconnected features show pending or unavailable.")} /></Card>
    <SetupPanel statuses={statuses} onOpen={onOpen} />
  </div>;
}
