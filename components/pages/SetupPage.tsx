"use client";

import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { SetupPanel } from "../setup/SetupPanel";
import { PageHeader } from "../ui/Page";
import { useI18n } from "../../lib/i18n";

export function SetupPage({ statuses, preview, onOpen }: { statuses: IntegrationStatus[]; preview: boolean; onOpen: (id: IntegrationId) => void }) {
  const { t } = useI18n();
  return <div className="page-content page-enter">
    <PageHeader title={t("初始化向导", "Setup")} description={t("集中检查真实数据源、受保护配置和运行状态；页面可在设置中隐藏。", "Review live data sources, protected configuration, and runtime state. This page can be hidden in Settings.")} />
    <SetupPanel statuses={statuses} onOpen={onOpen} preview={preview} />
  </div>;
}
