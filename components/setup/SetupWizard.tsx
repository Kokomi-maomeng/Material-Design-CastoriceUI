import { useState } from "react";
import { integrationDefinitions } from "../../lib/integrations";
import type { IntegrationId, IntegrationStatus } from "../../lib/types";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";

export function SetupWizard({ selected, status, preview, drafts, onDraft, onClose, onSave }: { selected: IntegrationId | null; status?: IntegrationStatus; preview: boolean; drafts: Record<string, Record<string, string>>; onDraft: (id: IntegrationId, field: string, value: string) => void; onClose: () => void; onSave: (id: IntegrationId, values: Record<string, string>) => Promise<void> }) {
  const definition = integrationDefinitions.find((item) => item.id === selected);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  if (!definition || !selected) return null;
  const values = drafts[selected] ?? {};
  const requiredComplete = definition.fields.filter((field) => field.required).every((field) => values[field.id]?.trim());
  const save = async () => { setSaving(true); try { await onSave(selected, values); setStep(2); } finally { setSaving(false); } };
  return <Dialog open title={`${definition.name} 配置向导`} description={definition.summary} onClose={onClose} size="large" actions={<><Button variant="text" onClick={onClose}>{status?.configured || step === 2 ? "完成" : "稍后继续"}</Button>{step > 0 && step < 2 ? <Button variant="outlined" onClick={() => setStep(step - 1)}>上一步</Button> : null}{step === 0 ? <Button trailingIcon="arrow_forward" onClick={() => setStep(1)}>开始配置</Button> : null}{step === 1 ? <Button icon="save" disabled={!requiredComplete || saving} onClick={save}>{saving ? "正在验证" : "保存并验证"}</Button> : null}</>}>
    <div className="wizard-progress" aria-label={`步骤 ${step + 1}/3`}>{["了解流程", "填写参数", "验证完成"].map((label, index) => <div key={label} className={index <= step ? "is-active" : ""}><span>{index < step ? <Icon name="check" size={16} /> : index + 1}</span><small>{label}</small></div>)}</div>
    {step === 0 ? <div className="wizard-overview"><div className="wizard-outcome"><Icon name={definition.icon} size={28} /><div><span>{preview ? "真实部署验证后" : "配置完成后"}</span><strong>{definition.outcome}</strong></div></div><ol>{definition.steps.map((item) => <li key={item}>{item}</li>)}</ol><div className="wizard-security"><Icon name="shield" /><p>{preview ? "当前是演示模式：输入不会离开浏览器，也不会验证或保存到服务器。" : "上游 Secret 只从服务器受限配置读取，不经网页提交、不写入 SQLite，也不会出现在响应或审计记录中。"}</p></div></div> : null}
    {step === 1 ? <div className="wizard-form">{definition.fields.length ? definition.fields.map((field) => <label className="field" key={field.id}><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={4} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} /> : <input type={field.type ?? "text"} value={values[field.id] ?? ""} placeholder={field.placeholder} onChange={(event) => onDraft(selected, field.id, event.target.value)} />}<small>{field.hint}</small></label>) : <div className="wizard-auto"><Icon name="autorenew" size={30} /><strong>无需手动参数</strong><p>后端会自动识别本机资源并执行只读验证。</p></div>}<p className="wizard-session-note"><Icon name="timer" size={18} />当前输入会在页面间切换时保留，但关闭或刷新浏览器后不会保留未提交内容。</p></div> : null}
    {step === 2 ? <div className="wizard-success"><Icon name={preview ? "science" : "check_circle"} size={52} filled /><h3>{preview ? "演示流程完成" : status?.configured ? "配置已检查" : "参数已保存"}</h3><p>{preview ? "没有保存配置，也没有验证任何真实服务。" : status?.summary || "后端已接收配置；返回页面后会自动刷新接入状态。"}</p><Chip staticChip tone={preview ? "default" : "success"}>{preview ? "仅演示" : "验证完成"}</Chip></div> : null}
  </Dialog>;
}
