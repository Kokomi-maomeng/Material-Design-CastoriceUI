"use client";

import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { SetupPanel } from "../setup/SetupPanel";
import { PageHeader } from "../ui/Page";

export function SetupPage({ statuses, preview, onOpen }: { statuses: IntegrationStatus[]; preview: boolean; onOpen: (id: IntegrationId) => void }) {
  return <div className="page-content page-enter">
    <PageHeader title="初始化向导" description="集中检查真实数据源、受保护配置和运行状态；页面可在设置中隐藏。" />
    <SetupPanel statuses={statuses} onOpen={onOpen} preview={preview} />
  </div>;
}
