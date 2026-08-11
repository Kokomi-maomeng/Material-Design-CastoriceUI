"use client";

import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { AuditEvent, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

const AUDIT_ACTION_EN: Record<string, string> = {
  更新流量额度: "Updated traffic quota",
  更新面板设置: "Updated panel settings",
  更新登录背景: "Updated sign-in background",
  创建初始管理员: "Created initial administrator",
  登录失败: "Sign-in failed",
  登录成功: "Signed in",
  退出登录: "Signed out",
  完成初始化向导: "Completed initialization",
  确认告警: "Acknowledged alert",
  清理旧版接入密钥: "Removed legacy integration secret",
  更新数据接入: "Updated data integration",
  更新网络探测目标: "Updated network probe targets",
};

const AUDIT_DETAIL_EN: Record<string, string> = {
  总流量额度已更新: "The total traffic quota was updated",
  导航可见性设置已更新: "Navigation visibility settings were updated",
  首次安全初始化已完成: "Secure first-run administrator creation completed",
  用户名或密码错误: "The username or password was incorrect",
  管理员会话已创建: "An administrator session was created",
  管理员会话已注销: "The administrator session was invalidated",
  必要的面板设置已确认: "Required panel settings were confirmed",
  "已从 SQLite 覆盖项中移除 v1.2 遗留的明文 Secret":
    "A legacy v1.2 plaintext Secret was removed from SQLite overrides",
};

function auditDetailEn(value: string) {
  if (AUDIT_DETAIL_EN[value]) return AUDIT_DETAIL_EN[value];
  return value
    .replace(/^(.+) 接入配置已更新$/, "$1 integration settings were updated")
    .replace(/^已保存 (\d+) 个探测目标$/, "$1 probe targets were saved")
    .replace(/^登录背景类型已设为 (.+)$/, "Sign-in background type set to $1")
    .replace(/^告警 (.+) 已确认$/, "Alert $1 was acknowledged");
}

export function AuditPage({
  events,
  integration,
  onConfigure,
}: {
  events: AuditEvent[];
  integration?: IntegrationStatus;
  onConfigure: () => void;
}) {
  const { language, t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"全部" | AuditEvent["category"]>(
    "全部",
  );
  const visible = useMemo(
    () =>
      events.filter(
        (event) =>
          (category === "全部" || event.category === category) &&
          `${event.action} ${event.actor} ${event.ip} ${event.detail}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [category, events, search],
  );
  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow={t("安全与追溯", "Security and traceability")}
        title={t("操作审计", "Audit log")}
        description={t(
          "记录登录、配置、告警确认与服务生命周期等关键操作。",
          "Record sign-ins, configuration, alert acknowledgements, and service lifecycle events.",
        )}
      />
      <IntegrationGate
        status={integration}
        name="操作审计"
        nameEn="Audit log"
        description="记录配置更新、告警确认和服务生命周期事件。"
        descriptionEn="Record configuration changes, alert acknowledgements, and service lifecycle events."
        onConfigure={onConfigure}
      />
      <div className="audit-retention">
        <Icon name="policy" size={23} />
        <div>
          <strong>{t("审计保留策略", "Audit retention")}</strong>
          <span>
            {t(
              "保留周期由服务器配置管理；密码、Token 和私钥不会写入详情，记录不能从面板删除。",
              "Retention is managed on the server. Passwords, tokens, and private keys are excluded, and records cannot be deleted from the panel.",
            )}
          </span>
        </div>
        <Chip staticChip tone="success">
          {t("策略生效", "Policy active")}
        </Chip>
      </div>
      <Card variant="outlined" className="table-panel">
        <div className="table-toolbar table-toolbar--wrap">
          <label className="search-field">
            <Icon name="search" size={20} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(
                "搜索操作、账号或 IP",
                "Search action, account, or IP",
              )}
              aria-label={t("搜索审计记录", "Search audit records")}
            />
          </label>
          <div className="filter-chips">
            {(["全部", "认证", "账号", "配置", "系统"] as const).map((item) => (
              <Chip
                key={item}
                selected={category === item}
                onClick={() => setCategory(item)}
              >
                {item === "全部"
                  ? t("全部", "All")
                  : item === "认证"
                    ? t("认证", "Authentication")
                    : item === "账号"
                      ? t("账号", "Account")
                      : item === "配置"
                        ? t("配置", "Configuration")
                        : t("系统", "System")}
              </Chip>
            ))}
          </div>
        </div>
        <div className="responsive-table audit-table">
          <table>
            <thead>
              <tr>
                <th>{t("时间", "Time")}</th>
                <th>{t("操作", "Action")}</th>
                <th>{t("类别", "Category")}</th>
                <th>{t("操作者", "Actor")}</th>
                <th>{t("来源 IP", "Source IP")}</th>
                <th>{t("结果", "Result")}</th>
                <th>{t("详情", "Details")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td data-label={t("时间", "Time")}>
                    <span className="mono-time">{event.time}</span>
                  </td>
                  <td data-label={t("操作", "Action")}>
                    <strong>
                      {language === "zh"
                        ? event.action
                        : AUDIT_ACTION_EN[event.action] || event.action}
                    </strong>
                  </td>
                  <td data-label={t("类别", "Category")}>
                    <Chip staticChip>
                      {event.category === "认证"
                        ? t("认证", "Authentication")
                        : event.category === "账号"
                          ? t("账号", "Account")
                          : event.category === "配置"
                            ? t("配置", "Configuration")
                            : t("系统", "System")}
                    </Chip>
                  </td>
                  <td data-label={t("操作者", "Actor")}>
                    <span className="actor">
                      <Icon
                        name={event.actor === "system" ? "smart_toy" : "person"}
                        size={18}
                      />
                      {event.actor}
                    </span>
                  </td>
                  <td data-label={t("来源 IP", "Source IP")}>
                    <code>{event.ip}</code>
                  </td>
                  <td data-label={t("结果", "Result")}>
                    <Chip
                      staticChip
                      tone={event.result === "成功" ? "success" : "danger"}
                      icon={event.result === "成功" ? "check" : "close"}
                    >
                      {event.result === "成功"
                        ? t("成功", "Success")
                        : t("失败", "Failed")}
                    </Chip>
                  </td>
                  <td data-label={t("详情", "Details")}>
                    <span className="muted">
                      {language === "zh"
                        ? event.detail
                        : auditDetailEn(event.detail)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            {t(
              `显示最近 ${visible.length} 条记录`,
              `Showing ${visible.length} recent records`,
            )}
          </span>
          <span>
            {t(
              "敏感参数在写入前由后端移除",
              "Sensitive parameters are removed before storage",
            )}
          </span>
        </div>
      </Card>
    </div>
  );
}
