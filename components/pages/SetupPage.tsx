"use client";

import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { SetupPanel } from "../setup/SetupPanel";
import { PageHeader } from "../ui/Page";
import { useI18n } from "../../lib/i18n";

export function SetupPage({ statuses, onOpen }: { statuses: IntegrationStatus[]; onOpen: (id: IntegrationId) => void }) {
  const { t } = useI18n();
  return <div className="page-content page-enter">
    <PageHeader title={t("初始化向导", "Setup")} />
    <SetupPanel statuses={statuses} onOpen={onOpen} />
  </div>;
}
