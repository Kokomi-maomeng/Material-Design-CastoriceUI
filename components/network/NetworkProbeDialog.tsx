import { useEffect, useId, useRef, useState } from "react";
import { updateNetworkTargets } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { draftTarget, emptyTarget, NETWORK_LIMITS, targetPayload, validateTargets, type TargetDraft } from "../../lib/network-editor";
import type { IntegrationStatus, NetworkTarget, NetworkTargetConfig } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";

export function NetworkProbeDialog({ open, onClose, targets, alertIntegration, onSaved, onToast }: {
  open: boolean; onClose: () => void; targets: NetworkTarget[]; alertIntegration?: IntegrationStatus;
  onSaved: (targets: NetworkTargetConfig[]) => Promise<void>; onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const wasOpen = useRef(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<TargetDraft[]>([]);
  const [global, setGlobal] = useState({ latencyMs: "", lossPercent: "" });
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDrafts([...targets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(draftTarget));
      setGlobal({ latencyMs: alertIntegration?.values?.latencyMs ?? "", lossPercent: alertIntegration?.values?.lossPercent ?? "" });
      setSaveError("");
    }
    wasOpen.current = open;
  }, [open, targets, alertIntegration]);
  const errors = validateTargets(drafts);
  const globalInvalid = Boolean(global.latencyMs) !== Boolean(global.lossPercent)
    || Boolean(alertIntegration) && (!global.latencyMs || !global.lossPercent)
    || global.latencyMs !== "" && (!Number.isFinite(Number(global.latencyMs)) || Number(global.latencyMs) < 0 || Number(global.latencyMs) > 60000)
    || global.lossPercent !== "" && (!Number.isFinite(Number(global.lossPercent)) || Number(global.lossPercent) < 0 || Number(global.lossPercent) > 100);
  const invalid = drafts.length < 1 || drafts.length > NETWORK_LIMITS.maxTargets || errors.some((row) => Object.keys(row).length > 0) || globalInvalid;
  const change = (index: number, key: keyof TargetDraft, value: string) => {
    setSaveError("");
    setDrafts((current) => current.map((item, i) => i === index ? { ...item, [key]: key === "ipVersion" ? Number(value) : value } : item));
  };
  const save = async () => {
    if (busy.current || invalid) return;
    busy.current = true; setSaving(true); setSaveError("");
    try {
      const saved = await updateNetworkTargets(targetPayload(drafts), global.latencyMs && global.lossPercent ? { latencyMs: Number(global.latencyMs), lossPercent: Number(global.lossPercent) } : undefined);
      await onSaved(saved.targets);
      onClose(); onToast(t("网络探测目标已保存", "Network probe targets saved"));
    } catch {
      setSaveError(t("保存失败，请检查连接并重试；当前编辑内容已保留。", "Unable to save. Check the connection and retry; your edits are retained."));
    } finally { busy.current = false; setSaving(false); }
  };
  return <Dialog open={open} onClose={() => { if (!busy.current) onClose(); }} className="network-editor-dialog" size="large"
    title={t("自定义网络探测", "Customize network probes")}
    description={t(`最多 ${NETWORK_LIMITS.maxTargets} 个目标；排序留空自动分配，保存后按顺序显示。`, `Up to ${NETWORK_LIMITS.maxTargets} targets. Automatic fills unused positions; saved targets appear in order.`)}
    actions={<><Button variant="text" disabled={saving} onClick={onClose}>{t("取消", "Cancel")}</Button><Button icon="save" disabled={saving || invalid} onClick={() => void save()}>{saving ? t("保存中…", "Saving…") : t("保存", "Save")}</Button></>}>
    <div className="network-editor">
      <p className="field-hint network-editor-help">{t("名称与探测地址必填，支持 IP 或域名。ICMP 默认启用；TCP、DNS 可独立选填，也可都留空。DNS 需服务器 IP，仅填验证域名时使用 UDP 53；仅填 DNS 端口时验证 example.com。", "Name and address are required; IPs and host names are supported. ICMP is always enabled. TCP and DNS are independent and optional. DNS requires a server IP; a check name alone uses UDP 53, and a DNS port alone checks example.com.")}</p>
      <fieldset className="network-alert-editor"><legend>{t("全局网络告警", "Global network alerts")}</legend><div className="form-grid">
        <label><span>{t("延迟阈值 (ms)", "Latency threshold (ms)")}</span><input type="number" min="0" max="60000" step="any" value={global.latencyMs} onChange={(e) => setGlobal((current) => ({ ...current, latencyMs: e.target.value }))} /></label>
        <label><span>{t("丢包阈值 (%)", "Loss threshold (%)")}</span><input type="number" min="0" max="100" step="any" value={global.lossPercent} onChange={(e) => setGlobal((current) => ({ ...current, lossPercent: e.target.value }))} /></label>
      </div>{globalInvalid ? <small className="network-field-error" role="alert">{t("两项阈值需同时填写；延迟为 0–60000 ms，丢包为 0–100%。", "Enter both thresholds: latency 0–60000 ms and loss 0–100%.")}</small> : null}</fieldset>
      {drafts.map((item, index) => {
        const error = errors[index];
        const fieldError = (key: keyof TargetDraft) => error[key] ? `${id}-${index}-${key}` : undefined;
        const input = (key: "name" | "address" | "tcpPort" | "dnsPort" | "dnsName", zh: string, en: string, placeholder = "") => <div className={`network-editor-field network-editor-field--${key}`}>
          <label htmlFor={`${id}-input-${index}-${key}`}>{t(zh, en)}</label><input id={`${id}-input-${index}-${key}`} required={key === "name" || key === "address"} value={item[key]} maxLength={key === "name" ? NETWORK_LIMITS.maxNameLength : key.endsWith("Port") ? 6 : NETWORK_LIMITS.maxHostLength} inputMode={key.endsWith("Port") ? "numeric" : "text"} autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error[key])} aria-describedby={fieldError(key)} placeholder={placeholder} onChange={(e) => change(index, key, e.target.value)} />
          {error[key] ? <small id={fieldError(key)} className="network-field-error">{t(...error[key])}</small> : null}
        </div>;
        return <fieldset className="network-editor-row" key={index} disabled={saving}>
          <legend>{t(`目标 ${index + 1}`, `Target ${index + 1}`)}</legend>
          <div className="network-editor-field network-editor-field--order"><span>{t("排序", "Order")}</span><MaterialSelect ariaLabel={t("排序", "Order")} minimumPopupWidth={120} value={item.order} onChange={(v) => change(index, "order", v)} invalid={Boolean(error.order)} describedBy={fieldError("order")} options={[{ value: "", label: t("自动", "Auto") }, ...Array.from({ length: NETWORK_LIMITS.maxTargets }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]} />{error.order ? <small id={fieldError("order")} className="network-field-error">{t(...error.order)}</small> : null}</div>
          {input("name", "名称", "Name")}
          <div className="network-editor-field network-editor-field--family"><span>{t("解析协议族", "Address family")}</span><MaterialSelect ariaLabel={t("解析协议族", "Address family")} value={String(item.ipVersion)} invalid={Boolean(error.ipVersion)} describedBy={fieldError("ipVersion")} onChange={(v) => change(index, "ipVersion", v)} options={[{ value: "0", label: t("自动", "Automatic") }, { value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }]} />{error.ipVersion ? <small id={fieldError("ipVersion")} className="network-field-error">{t(...error.ipVersion)}</small> : null}</div>
          <button type="button" className="icon-button" aria-label={t("删除目标", "Remove target")} onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}><Icon name="delete" /></button>
          {input("address", "探测地址", "Probe address", "1.1.1.1 / example.com")}
          {input("dnsName", "DNS 验证名称", "DNS check name", "example.com")}
          {input("tcpPort", "TCP 端口", "TCP port", t("可选", "Optional"))}
          {input("dnsPort", "DNS(UDP) 端口", "DNS(UDP) port", t("可选", "Optional"))}
        </fieldset>;
      })}
      {invalid ? <p className="network-field-error" role="status">{t(`请修正标出的内容；需保留 1–${NETWORK_LIMITS.maxTargets} 个目标，排序和地址不能重复。`, `Correct the marked fields. Keep 1–${NETWORK_LIMITS.maxTargets} targets with unique orders and addresses.`)}</p> : null}
      {saveError ? <div className="dialog-error" role="alert">{saveError}</div> : null}
      <Button variant="tonal" icon="add" disabled={saving || drafts.length >= NETWORK_LIMITS.maxTargets} onClick={() => setDrafts((current) => [...current, emptyTarget()])}>{t("添加目标", "Add target")} · {drafts.length}/{NETWORK_LIMITS.maxTargets}</Button>
    </div>
  </Dialog>;
}
