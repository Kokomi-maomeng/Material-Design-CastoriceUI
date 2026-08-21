import { useState } from "react";
import { integrationDefinitions } from "../../lib/integrations";
import { useI18n } from "../../lib/i18n";
import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";

export function SetupWizard({ selected, status, drafts, onDraft, onClose, onSave }: { selected: IntegrationId | null; status?: IntegrationStatus; drafts: Record<string, Record<string, string>>; onDraft: (id: IntegrationId, field: string, value: string) => void; onClose: () => void; onSave: (id: IntegrationId, values: Record<string, string>) => Promise<void> }) {
  const { language, t } = useI18n();
  const definition = integrationDefinitions.find((item) => item.id === selected);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  if (!definition || !selected) return null;
  const local = (value: { zh: string; en: string }) => value[language];
  const values = drafts[selected] ?? {};
  const resolvedValues = Object.fromEntries(definition.fields.map((field) => [field.id, values[field.id] ?? field.options?.[0]?.value ?? ""]));
  const requiredComplete = definition.fields.filter((field) => field.required).every((field) => resolvedValues[field.id]?.trim());
  const save = async () => { setSaving(true); try { await onSave(selected, resolvedValues); setStep(2); } finally { setSaving(false); } };
  const steps = [t("了解流程", "Overview"), t("填写参数", "Parameters"), t("验证完成", "Verified")];
  return <Dialog open title={t(`${local(definition.name)} 配置向导`, `Configure ${local(definition.name)}`)} description={local(definition.summary)} onClose={onClose} size="large" actions={<><Button variant="text" onClick={onClose}>{status?.configured || step === 2 ? t("完成", "Done") : t("稍后继续", "Continue later")}</Button>{step > 0 && step < 2 ? <Button variant="outlined" onClick={() => setStep(step - 1)}>{t("上一步", "Back")}</Button> : null}{step === 0 ? <Button trailingIcon="arrow_forward" onClick={() => setStep(1)}>{t("开始配置", "Start")}</Button> : null}{step === 1 ? <Button icon="save" disabled={!requiredComplete || saving} onClick={() => void save()}>{saving ? t("正在验证", "Validating") : t("保存并验证", "Save and validate")}</Button> : null}</>}>
    <div className="wizard-progress" aria-label={t(`步骤 ${step + 1}/3`, `Step ${step + 1} of 3`)}>{steps.map((label, index) => <div key={label} className={index <= step ? "is-active" : ""}><span>{index < step ? <Icon name="check" size={16} /> : index + 1}</span><small>{label}</small></div>)}</div>
    {step === 0 ? <div className="wizard-overview"><div className="wizard-outcome"><Icon name={definition.icon} size={28} /><div><span>{t("配置完成后", "After configuration")}</span><strong>{local(definition.outcome)}</strong></div></div><ol>{definition.steps.map((item) => <li key={item.zh}>{local(item)}</li>)}</ol><div className="wizard-security"><Icon name="shield" /><p>{t("上游 Secret 只从服务器受限配置读取，不经网页提交、不写入 SQLite，也不会出现在响应或审计记录中。", "Upstream secrets are read only from protected server configuration. They are never submitted by the browser, written to SQLite, or returned in responses or audit records.")}</p></div></div> : null}
    {step === 1 ? <div className="wizard-form">{definition.fields.length ? definition.fields.map((field) => <div className="field" key={field.id}><span>{local(field.label)}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={4} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} /> : field.type === "select" ? <MaterialSelect ariaLabel={local(field.label)} value={values[field.id] ?? field.options?.[0]?.value ?? ""} options={(field.options ?? []).map((option) => ({ value: option.value, label: local(option.label) }))} onChange={(value) => onDraft(selected, field.id, value)} /> : <input aria-label={local(field.label)} type={field.type ?? "text"} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} />}<small>{local(field.hint)}</small></div>) : <div className="wizard-auto"><Icon name="autorenew" size={30} /><strong>{t("无需手动参数", "No manual parameters")}</strong><p>{t("后端会自动识别本机资源并执行只读验证。", "The backend detects local resources and performs read-only checks.")}</p></div>}</div> : null}
    {step === 2 ? <div className="wizard-success"><Icon name="check_circle" size={52} filled /><h3>{t("配置已验证", "Configuration verified")}</h3><Chip staticChip tone="success">{t("验证完成", "Verified")}</Chip></div> : null}
  </Dialog>;
}
