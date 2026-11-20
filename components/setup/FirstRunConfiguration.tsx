import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import type { InitializationBasics, IntegrationId, IntegrationStatus, OverviewMetrics } from "../../lib/types";
import { useI18n } from "../../lib/i18n";
import { PROJECT_VERSION } from "../../lib/project";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { LanguageSelect } from "../ui/LanguageSelect";

const OPTIONAL_PROTOCOLS: Array<{ id: IntegrationId; label: string; icon: string }> = [
  { id: "hysteria2", label: "Hysteria2", icon: "bolt" },
  { id: "anytls", label: "AnyTLS", icon: "encrypted" },
  { id: "vless", label: "VLESS", icon: "route" },
  { id: "socks5", label: "SOCKS5", icon: "lan" },
  { id: "shadowsocks", label: "Shadowsocks", icon: "shield" },
  { id: "vmess", label: "VMess", icon: "hub" },
  { id: "trojan", label: "Trojan", icon: "security" },
  { id: "tuic", label: "TUIC", icon: "speed" },
];

export function FirstRunConfiguration({ metrics, integrations, initialBasics, onConfigure, onSaveBasics, onComplete, onSignOut, signingOut = false }: {
  metrics: OverviewMetrics;
  integrations: IntegrationStatus[];
  initialBasics?: InitializationBasics | null;
  onConfigure: (id: IntegrationId) => void;
  onSaveBasics: (basics: InitializationBasics) => Promise<InitializationBasics>;
  onComplete: () => Promise<void>;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const { t } = useI18n();
  const [nodeName, setNodeName] = useState(initialBasics?.nodeName ?? (metrics.nodeName === "VPS node" ? "" : metrics.nodeName));
  const [quotaGb, setQuotaGb] = useState(String(Math.max(1, (initialBasics?.quotaBytes ?? metrics.trafficLimitBytes) / 1_000_000_000)));
  const [confirmed, setConfirmed] = useState(initialBasics);
  const [phase, setPhase] = useState<"save" | "finish" | null>(null);
  const [error, setError] = useState<"name" | "quota" | "save" | "finish" | "complete" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const quotaInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  useEffect(() => { heading.current?.focus(); }, []);

  const quota = Number(quotaGb);
  const basics = { nodeName: nodeName.trim(), quotaBytes: Math.round(quota * 1_000_000_000) };
  const saved = confirmed?.nodeName === basics.nodeName && confirmed.quotaBytes === basics.quotaBytes;
  const busy = phase !== null || signingOut;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || saved) return;
    if (!basics.nodeName) {
      setError("name");
      nameInput.current?.focus();
      return;
    }
    if (!Number.isFinite(quota) || quota < 1 || quota > 1_000_000) {
      setError("quota");
      quotaInput.current?.focus();
      return;
    }
    setPhase("save");
    setError(null);
    try {
      setConfirmed(await onSaveBasics(basics));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "initialization_complete" ? "complete" : "save");
    } finally {
      setPhase(null);
    }
  };
  const complete = async () => {
    if (busy || !saved) return;
    setPhase("finish");
    setError(null);
    try {
      await onComplete();
    } catch {
      setError("finish");
    } finally {
      setPhase(null);
    }
  };
  const messages = {
    name: t("请输入节点显示名称", "Enter a node display name"),
    quota: t("请输入 1 到 1,000,000 GB 的额度", "Enter a quota from 1 to 1,000,000 GB"),
    save: t("保存失败。请检查服务器的采集网卡是否可读，再重试", "Could not save. Check that the server can read the network interface, then try again"),
    finish: t("暂时无法完成初始化，请重试", "Could not finish setup. Try again"),
    complete: t("初始化已在另一页面完成，请刷新进入总览", "Setup was completed in another tab. Refresh to open the dashboard"),
  };
  const status = (id: IntegrationId) => integrations.find((item) => item.id === id);
  const sortedProtocols = [...OPTIONAL_PROTOCOLS].sort((left, right) => {
    const score = (id: IntegrationId) => status(id)?.status === "ready" ? 0 : status(id)?.configured ? 1 : 2;
    return score(left.id) - score(right.id);
  });

  return <main className="first-run-page">
    <div className="first-run-header">
      <div className="auth-brand"><span className="brand-mark"><Icon name="ac_unit" size={26} filled /></span><div><strong>CastoriceUI</strong><span>v{PROJECT_VERSION}</span></div></div>
      <div className="first-run-actions">
        <LanguageSelect compact />
        <Button variant="text" icon="logout" onClick={onSignOut} disabled={busy}>{signingOut ? t("正在注销…", "Signing out…") : t("注销", "Sign out")}</Button>
      </div>
    </div>
    <section className="first-run-content">
      <header><p>{t("首次初始化", "First-run setup")}</p><h1 ref={heading} tabIndex={-1}>{t("确认真实数据接入", "Confirm live data integrations")}</h1><span>{t("先保存节点名称和流量额度。代理协议等数据源可以稍后配置。", "Save the node name and traffic quota first. You can configure proxy protocols and other data sources later.")}</span></header>
      <div className="first-run-steps" role="group" aria-label={t("初始化进度", "Setup progress")}>
        <span className="is-done"><b><Icon name="check" size={17} /></b>{t("管理员", "Administrator")}</span>
        <span className={saved ? "is-done" : "is-current"} aria-current={saved ? undefined : "step"}><b>{saved ? <Icon name="check" size={17} /> : 2}</b>{t("基础设置", "Basics")}</span>
        <span className={saved && phase !== "finish" ? "is-current" : ""} aria-current={saved && phase !== "finish" ? "step" : undefined}><b>3</b>{t("可选数据源", "Optional sources")}</span>
        <span className={phase === "finish" ? "is-current" : ""} aria-current={phase === "finish" ? "step" : undefined}><b>4</b>{t("完成", "Finish")}</span>
      </div>
      <Card variant="outlined"><CardHeader title={t("节点与流量额度", "Node and traffic quota")} />
        <form className="first-run-basics" onSubmit={(event) => void save(event)} noValidate>
          <label className="field">
            <span>{t("节点显示名称", "Node display name")}</span>
            <input ref={nameInput} required maxLength={80} value={nodeName} readOnly={busy} aria-invalid={error === "name"} aria-describedby={error === "name" ? hintId : undefined} onChange={(event) => { setNodeName(event.target.value); setError(null); }} placeholder={t("例如，东京边缘节点", "Example: Tokyo edge")} />
          </label>
          <label className="field">
            <span>{t("总流量额度（GB）", "Total traffic quota (GB)")}</span>
            <div className="quota-input-stable"><input ref={quotaInput} type="number" min="1" max="1000000" step="any" inputMode="decimal" required value={quotaGb} readOnly={busy} aria-invalid={error === "quota"} aria-describedby={error === "quota" ? hintId : undefined} onChange={(event) => { setQuotaGb(event.target.value); setError(null); }} /><span aria-hidden="true">GB</span></div>
          </label>
          <Button type="submit" icon={saved ? "check" : "save"} aria-disabled={busy || saved}>
            <span aria-live="polite">{phase === "save" ? t("正在保存…", "Saving…") : saved ? t("已保存", "Saved") : t("保存基础设置", "Save basics")}</span>
          </Button>
          {error && error !== "finish" ? <div className="dialog-error" role="alert" id={hintId}><Icon name="error" size={19} /><span>{messages[error]}</span></div> : null}
        </form>
      </Card>
      <Card variant="outlined" className="setup-prerequisites"><CardHeader title={t("服务器侧准备", "Server prerequisites")} description={t("网页向导不会安装代理核心或读取、保存上游密码。", "The web wizard does not install proxy cores or read and store upstream secrets.")} />
        <ul>
          <li>{t("部署前准备仅监听回环地址的后端、受保护配置文件和可写数据库目录。", "Before deployment, prepare a loopback-only backend, protected configuration file, and writable database directory.")}</li>
          <li>{t("使用 Hysteria2 或 sing-box 时，先在受保护配置中填写 API Secret，并确认对应探针服务正常运行。", "For Hysteria2 or sing-box, set API secrets in the protected server configuration and confirm the protocol probe is running.")}</li>
          <li>{t("账号管理及其订阅依赖受保护配置中的管理账号、身份映射和订阅记录；网页验证不会创建这些记录。", "Account management and its subscriptions require managed accounts, identity mappings, and subscription records in protected configuration; web validation does not create them.")}</li>
          <li>{t("CPU、内存和流量历史会在安装后逐步积累，近 24 小时曲线需要实际采样时间。", "CPU, memory, and traffic history accumulate after installation; the 24-hour charts need actual sampling time.")}</li>
        </ul>
      </Card>
      <Card variant="filled"><CardHeader title={t("代理协议", "Proxy protocols")} description={t("只配置服务器实际使用的协议。面板不会写入示例数据。", "Configure the protocols running on your server. The panel does not write sample data.")} />
        <div className="protocol-setup-grid">{sortedProtocols.map((item) => { const state = status(item.id); const ready = state?.status === "ready"; return <button key={item.id} onClick={() => onConfigure(item.id)}><span><Icon name={item.icon} /></span><div><strong>{item.label}</strong><small>{ready ? t("已连接并验证", "Connected and verified") : state?.configured ? t("已配置但当前不可用", "Configured but unavailable") : t("未配置", "Not configured")}</small></div><Chip staticChip tone={ready ? "success" : state?.configured ? "warning" : "default"}>{ready ? t("可用", "Ready") : t("配置", "Configure")}</Chip></button>; })}</div>
      </Card>
      <Card variant="outlined"><CardHeader title={t("其他数据源", "Other data sources")} description={t("网络质量、订阅和告警可以现在配置，也可以稍后在独立初始化向导中完成。", "Network quality, subscriptions, and alerts can be configured now or later from Setup.")} /><div className="first-run-links">{(["network", "subscriptions", "alerts"] as IntegrationId[]).map((id) => <Button key={id} variant="tonal" onClick={() => onConfigure(id)}>{id === "network" ? t("网络质量", "Network quality") : id === "subscriptions" ? t("订阅记录", "Subscriptions") : t("告警阈值", "Alert thresholds")}</Button>)}</div></Card>
      <div className="first-run-complete">
        <span>{saved ? t("已保存基础设置，可以打开总览。", "Basics are saved. You can open the dashboard.") : t("保存节点名称和流量额度后即可完成。", "Save the node name and traffic quota to finish.")}</span>
        <Button trailingIcon="arrow_forward" disabled={!saved} aria-disabled={busy} onClick={() => void complete()}>
          <span aria-live="polite">{phase === "finish" ? t("正在打开总览…", "Opening dashboard…") : t("完成并进入总览", "Finish and open dashboard")}</span>
        </Button>
        {error === "finish" ? <div className="dialog-error" role="alert"><Icon name="error" size={19} /><span>{messages.finish}</span></div> : null}
      </div>
    </section>
  </main>;
}
