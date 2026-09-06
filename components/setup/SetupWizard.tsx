import { useState } from "react";
import { integrationDefinitions } from "../../lib/integrations";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";
import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { ApiError } from "../../lib/api";

export function SetupWizard({ selected, status, drafts, onDraft, onClose, onSave }: { selected: IntegrationId | null; status?: IntegrationStatus; drafts: Record<string, Record<string, string>>; onDraft: (id: IntegrationId, field: string, value: string) => void; onClose: () => void; onSave: (id: IntegrationId, values: Record<string, string>) => Promise<IntegrationStatus> }) {
  const { language, t } = useI18n();
  const definition = integrationDefinitions.find((item) => item.id === selected);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<IntegrationStatus | null>(null);
  const [validationError, setValidationError] = useState("");
  if (!definition || !selected) return null;
  const local = (value: { zh: string; en: string }) => withoutTerminalPeriod(value[language]);
  const values = drafts[selected] ?? {};
  const resolvedValues = Object.fromEntries(definition.fields.map((field) => [field.id, values[field.id] ?? field.options?.[0]?.value ?? ""]));
  const isProtocol = ["hysteria2", "anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"].includes(selected);
  const requiredComplete = definition.fields.filter((field) => field.required).every((field) =>
    resolvedValues[field.id]?.trim() || (selected === "subscriptions" && field.id === "baseUrl" && status?.configured),
  );
  const save = async () => {
    setSaving(true);
    setValidationError("");
    try {
      const verified = await onSave(selected, resolvedValues);
      setResult(verified);
      setStep(2);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "";
      const fieldMessages: Record<string, string> = {
        missing_upstream_secret: t("请先在服务器受保护配置中填写该上游 Secret。", "Configure the upstream secret in the protected server configuration first."),
        missing_required_fields: t("请填写所有必填参数后再验证。", "Complete all required fields before validating."),
        inbound_tag_not_found: t("请确认入站标签在当前运行核心中存在且只映射一次。", "Confirm that every inbound tag exists uniquely in the running core."),
        protocol_probe_unavailable: t("协议状态采集不可用；请检查探针服务与状态文件。", "Protocol evidence is unavailable. Check the probe service and status file."),
        protocol_probe_stale: t("协议状态证据已过期；按既有变更流程重载核心并等待新探针结果。", "Protocol evidence is stale. Reload the core through the normal change procedure and wait for a fresh probe."),
        invalid_subscription: t("订阅 HTTPS 响应或节点格式无效；尚未验证客户端导入与代理连通性。", "The subscription HTTPS response or node format is invalid; client import and proxy connectivity remain unverified."),
        upstream_unavailable: t("无法连接本机上游 API；请检查服务、回环地址和认证配置。", "The loopback upstream API is unavailable. Check the service, endpoint, and authentication."),
        upstream_invalid_response: t("上游 API 已响应，但返回格式不符合要求。", "The upstream API responded with an unsupported payload."),
        network_unavailable: t("浏览器无法连接后端，请检查网络。", "The browser cannot reach the backend. Check the network."),
        request_timeout: t("验证请求超时，服务器未确认保存。", "The validation request timed out; the save was not confirmed."),
      };
      const fieldMessage = fieldMessages[code] ?? "";
      setValidationError(fieldMessage || (selected === "subscriptions"
        ? t("订阅发布器未通过服务器可达性与节点格式验证，配置未保存。请检查 TLS、地址、受保护订阅记录和返回内容。此验证不代表客户端导入或代理连通性。", "The publisher failed server-side reachability and node-format validation, so nothing was saved. Check TLS, the address, protected subscription records, and response content. This does not prove client import or proxy connectivity.")
        : isProtocol
          ? t("协议验证失败，新参数未应用。未完成的首次接入会保留异常状态；请检查必填项、API、入站标签和运行服务。", "Protocol validation failed; new values were not applied. Incomplete first-time setup remains visible as abnormal. Check required fields, the API, inbound tags, and running service.")
          : t("后端实际验证失败，配置未保存。请检查填写内容、运行服务和后端日志。", "Backend validation failed, so nothing was saved. Check the values, running service, and backend log.")));
    } finally {
      setSaving(false);
    }
  };
  const steps = [t("了解流程", "Overview"), t("填写参数", "Parameters"), t("验证结果", "Result")];
  return <Dialog open title={t(`${local(definition.name)} 配置向导`, `Configure ${local(definition.name)}`)} description={local(definition.summary)} onClose={onClose} size="large" actions={<><Button variant="text" onClick={onClose}>{status?.configured || step === 2 ? t("完成", "Done") : t("稍后继续", "Continue later")}</Button>{step > 0 && step < 2 ? <Button variant="outlined" onClick={() => setStep(step - 1)}>{t("上一步", "Back")}</Button> : null}{step === 0 ? <Button trailingIcon="arrow_forward" onClick={() => setStep(1)}>{t("开始配置", "Start")}</Button> : null}{step === 1 ? <Button icon="save" disabled={(!requiredComplete && !isProtocol) || saving} onClick={() => void save()}>{saving ? t("正在验证", "Validating") : t("保存并验证", "Save and validate")}</Button> : null}</>}>
    <div className="wizard-progress" aria-label={t(`步骤 ${step + 1}/3`, `Step ${step + 1} of 3`)}>{steps.map((label, index) => <div key={label} className={index <= step ? "is-active" : ""}><span>{index < step ? <Icon name="check" size={16} /> : index + 1}</span><small>{label}</small></div>)}</div>
    {step === 0 ? <div className="wizard-overview"><div className="wizard-outcome"><Icon name={definition.icon} size={28} /><div><span>{t("配置完成后", "After configuration")}</span><strong>{local(definition.outcome)}</strong></div></div><ol>{definition.steps.map((item) => <li key={item.zh}>{local(item)}</li>)}</ol><div className="wizard-security"><Icon name="shield" /><p>{selected === "subscriptions" ? t("订阅验证地址通过当前 HTTPS 管理会话提交，仅用于一次实际请求；后端不会把它写入 SQLite、响应或审计记录。长期使用的完整地址仍只保存在服务器受保护配置。", "The subscription URL is submitted through the current HTTPS admin session for one live request only. It is not written to SQLite, responses, or audit records; long-lived full URLs remain only in protected server configuration.") : t("上游 Secret 只从服务器受限配置读取，不经网页提交、不写入 SQLite，也不会出现在响应或审计记录中。", "Upstream secrets are read only from protected server configuration. They are never submitted by the browser, written to SQLite, or returned in responses or audit records.")}</p></div></div> : null}
    {step === 1 ? <div className="wizard-form">{definition.fields.length ? definition.fields.map((field) => <div className="field" key={field.id}><span>{local(field.label)}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={4} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} /> : field.type === "select" ? <MaterialSelect ariaLabel={local(field.label)} value={values[field.id] ?? field.options?.[0]?.value ?? ""} options={(field.options ?? []).map((option) => ({ value: option.value, label: local(option.label) }))} onChange={(value) => onDraft(selected, field.id, value)} /> : <input aria-label={local(field.label)} type={field.type ?? "text"} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} />}<small>{local(field.hint)}</small></div>) : <div className="wizard-auto"><Icon name="autorenew" size={30} /><strong>{t("无需手动参数", "No manual parameters")}</strong><p>{t("后端会自动识别本机资源并执行只读验证。", "The backend detects local resources and performs read-only checks.")}</p></div>}{validationError ? <div className="dialog-error" role="alert"><Icon name="error" size={19} /><span>{validationError}</span></div> : null}</div> : null}
    {step === 2 ? <div className={`wizard-success ${result?.status === "ready" ? "" : "is-warning"}`}><Icon name={result?.status === "ready" ? "check_circle" : "warning"} size={52} filled /><h3>{result?.status === "ready" ? t("配置已保存并通过实际验证", "Configuration saved and live-verified") : t("配置已保存，但运行验证未通过", "Configuration saved, but runtime validation failed")}</h3><Chip staticChip tone={result?.status === "ready" ? "success" : "warning"}>{result?.status === "ready" ? t("验证通过", "Verified") : t("需要检查", "Needs attention")}</Chip>{result ? <p>{t(result.summaryZh || result.summary, result.summaryEn || result.summary)}</p> : null}</div> : null}
  </Dialog>;
}
