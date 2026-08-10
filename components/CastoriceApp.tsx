import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  navigation,
  previewDashboard,
} from "../lib/demo-data";
import { acknowledgeAlert, configureIntegration, fetchDashboard, updateTrafficLimit } from "../lib/api";
import type { Account, AlertItem, DashboardPayload, IntegrationId, PageId, Subscription } from "../lib/types";
import { SetupWizard } from "./setup/SetupWizard";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";

type ThemeMode = "light" | "dark" | "system";
type ThemeColor = "violet" | "blue" | "green" | "rose" | "amber";
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_COLORS: ThemeColor[] = ["violet", "blue", "green", "rose", "amber"];
const PAGE_IDS = new Set<PageId>(navigation.map((item) => item.id));
const OverviewPage = lazy(() => import("./pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const AccountsPage = lazy(() => import("./pages/AccountsPage").then((module) => ({ default: module.AccountsPage })));
const AlertsPage = lazy(() => import("./pages/AlertsPage").then((module) => ({ default: module.AlertsPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })));
const ConnectionsPage = lazy(() => import("./pages/ConnectionsPage").then((module) => ({ default: module.ConnectionsPage })));
const NetworkPage = lazy(() => import("./pages/NetworkPage").then((module) => ({ default: module.NetworkPage })));
const ServicesPage = lazy(() => import("./pages/ServicesPage").then((module) => ({ default: module.ServicesPage })));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage").then((module) => ({ default: module.SubscriptionsPage })));
const TrafficPage = lazy(() => import("./pages/TrafficPage").then((module) => ({ default: module.TrafficPage })));

function readPreference<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && allowed.includes(value as T) ? value as T : fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The selected theme still applies when storage is blocked.
  }
}

function pageFromHash(): PageId {
  const candidate = window.location.hash.replace(/^#\/?/, "") as PageId;
  return PAGE_IDS.has(candidate) ? candidate : "overview";
}

export function CastoriceApp() {
  const [page, setPage] = useState<PageId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readPreference("castorice-theme-mode", THEME_MODES, "system"));
  const [themeColor, setThemeColor] = useState<ThemeColor>(() => readPreference("castorice-theme-color", THEME_COLORS, "violet"));
  const [showSetup, setShowSetup] = useState(() => readPreference("castorice-setup-panel", ["show", "hide"], "show") === "show");
  const [dashboard, setDashboard] = useState<DashboardPayload>(previewDashboard);
  const [backendOnline, setBackendOnline] = useState(false);
  const [draftLimit, setDraftLimit] = useState(String(Math.round(previewDashboard.overview.trafficLimitBytes / 1024 ** 3)));
  const [accounts, setAccounts] = useState<Account[]>(previewDashboard.accounts);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(previewDashboard.subscriptions);
  const [alerts, setAlerts] = useState<AlertItem[]>(previewDashboard.alerts);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connections, setConnections] = useState(previewDashboard.connections);
  const [selectedSetup, setSelectedSetup] = useState<IntegrationId | null>(null);
  const [setupDrafts, setSetupDrafts] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = themeMode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : themeMode;
      root.dataset.theme = resolved;
      root.dataset.themeColor = themeColor;
      root.style.colorScheme = resolved;
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof media.addEventListener === "function") media.addEventListener("change", apply);
    else media.addListener(apply);
    writePreference("castorice-theme-mode", themeMode);
    writePreference("castorice-theme-color", themeColor);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", apply);
      else media.removeListener(apply);
    };
  }, [themeColor, themeMode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const payload = await fetchDashboard();
      setDashboard(payload);
      setAccounts(payload.accounts);
      setSubscriptions(payload.subscriptions);
      setAlerts(payload.alerts);
      setConnections(payload.connections);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadDashboard(), 0);
    const timer = window.setInterval(() => void loadDashboard(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadDashboard]);

  useEffect(() => writePreference("castorice-setup-panel", showSetup ? "show" : "hide"), [showSetup]);

  useEffect(() => {
    const syncPage = () => setPage(pageFromHash());
    syncPage();
    window.addEventListener("hashchange", syncPage);
    window.addEventListener("popstate", syncPage);
    return () => {
      window.removeEventListener("hashchange", syncPage);
      window.removeEventListener("popstate", syncPage);
    };
  }, []);

  const pageTitle = navigation.find((item) => item.id === page)?.label ?? "总览";
  const unacknowledgedAlerts = alerts.filter((item) => !item.acknowledged).length;

  const navigate = useCallback((id: PageId) => {
    setPage(id);
    setDrawerOpen(false);
    const nextHash = `#/${id}`;
    if (window.location.hash !== nextHash) window.history.pushState(null, "", nextHash);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, []);

  const showToast = useCallback((message: string) => setToast(message), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const integrationFor = useCallback((id: IntegrationId) => dashboard.integrations.find((item) => item.id === id), [dashboard.integrations]);
  const configurePage = useCallback((id: IntegrationId) => setSelectedSetup(id), []);
  const saveIntegration = useCallback(async (id: IntegrationId, values: Record<string, string>) => {
    try {
      await configureIntegration(id, true, values);
      await loadDashboard();
      showToast("配置已保存并通过后端验证");
    } catch {
      setDashboard((current) => ({ ...current, integrations: current.integrations.map((item) => item.id === id ? { ...item, enabled: true, configured: true, status: "ready", summary: "本地预览配置已完成" } : item) }));
      showToast("本地预览已完成；部署后会由后端执行真实验证");
    }
  }, [loadDashboard, showToast]);

  const content = useMemo(() => {
    switch (page) {
      case "accounts":
        return <AccountsPage accounts={accounts} integration={integrationFor("hysteria2")} onConfigure={() => configurePage("hysteria2")} onCreate={(account) => { setAccounts((current) => [...current, account]); showToast(`已创建账号草稿 ${account.name}`); }} onToggle={(id) => { setAccounts((current) => current.map((account) => account.id === id ? { ...account, status: account.status === "disabled" ? "active" : "disabled", onlineDevices: account.status === "disabled" ? account.onlineDevices : 0 } : account)); showToast("账号状态已更新"); }} onResetPassword={(account) => showToast(`${account.name} 的密码重置请求需要协议适配器支持`)} onToast={showToast} />;
      case "connections": return <ConnectionsPage connections={connections} now={now} onToast={showToast} integration={integrationFor("connections")} onConfigure={() => configurePage("connections")} />;
      case "traffic": return <TrafficPage onToast={showToast} traffic={dashboard.traffic} integration={integrationFor("traffic")} onConfigure={() => configurePage("traffic")} />;
      case "subscriptions": return <SubscriptionsPage subscriptions={subscriptions} integration={integrationFor("subscriptions")} onConfigure={() => configurePage("subscriptions")} onToast={showToast} onRotate={(id) => { setSubscriptions((current) => current.map((item) => item.id === id ? { ...item, tokenHint: `new••••${Math.random().toString(36).slice(-4)}`, updatedAt: "刚刚" } : item)); showToast("订阅 Token 已轮换"); }} />;
      case "network": return <NetworkPage targets={dashboard.networkTargets} onToast={showToast} integration={integrationFor("network")} onConfigure={() => configurePage("network")} />;
      case "services": return <ServicesPage services={dashboard.services} metrics={dashboard.overview} onToast={showToast} integration={integrationFor("system")} onConfigure={() => configurePage("system")} />;
      case "alerts": return <AlertsPage alerts={alerts} integration={integrationFor("alerts")} onConfigure={() => configurePage("alerts")} onAcknowledge={(id) => { setAlerts((current) => current.map((item) => item.id === id ? { ...item, acknowledged: true } : item)); void acknowledgeAlert(id).catch(() => undefined); showToast("告警已确认"); }} onToast={showToast} />;
      case "audit": return <AuditPage events={dashboard.auditEvents} onToast={showToast} integration={integrationFor("audit")} onConfigure={() => configurePage("audit")} />;
      default: return <OverviewPage metrics={dashboard.overview} connections={connections} services={dashboard.services} integrations={dashboard.integrations} resourceHistory={dashboard.resourceHistory} showSetup={showSetup} onOpenSetup={configurePage} onEditQuota={() => { setDraftLimit(String(Math.round(dashboard.overview.trafficLimitBytes / 1024 ** 3))); setQuotaOpen(true); }} onRefresh={() => { void loadDashboard(); showToast("正在刷新实时指标"); }} onViewServices={() => navigate("services")} />;
    }
  }, [accounts, alerts, configurePage, connections, dashboard, integrationFor, loadDashboard, navigate, now, page, showSetup, showToast, subscriptions]);

  return (
    <div className="app-shell">
      <aside className={`navigation-rail ${drawerOpen ? "is-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Icon name="ac_unit" size={25} filled /></span><div><strong>CastoriceUI</strong><span>VPS Console</span></div></div>
        <nav aria-label="主导航">
          {navigation.map((item) => {
            const badge = item.id === "alerts" ? unacknowledgedAlerts : item.badge;
            return <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => navigate(item.id)} aria-current={page === item.id ? "page" : undefined} aria-label={badge ? `${item.label} ${badge}` : item.label} title={item.label}><Icon name={item.icon} filled={page === item.id} /><span>{item.label}</span>{badge ? <em>{badge}</em> : null}</button>;
          })}
        </nav>
        <div className="nav-footer"><div className="nav-status"><span className={`status-dot ${backendOnline ? "status-dot--online" : "status-dot--warning"}`} /><div><strong>{dashboard.overview.nodeName}</strong><span>{backendOnline ? "实时数据已连接" : "本地预览模式"}</span></div></div><button onClick={() => setThemeOpen(true)} aria-label="主题与外观" title="主题与外观"><Icon name="palette" /><span>主题与外观</span></button></div>
      </aside>
      {drawerOpen ? <button className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="关闭导航" /> : null}

      <div className="app-main">
        <header className="top-app-bar">
          <div className="top-app-bar__start"><Button variant="text" icon="menu" className="menu-button" aria-label="打开导航" onClick={() => setDrawerOpen(true)} /><div className="mobile-brand"><span className="brand-mark"><Icon name="ac_unit" size={21} filled /></span><strong>{pageTitle}</strong></div></div>
          <div className={`demo-indicator ${backendOnline ? "is-live" : ""}`}><Icon name={backendOnline ? "cloud_done" : "preview"} size={18} /><span>{backendOnline ? `实时数据 · ${new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "本地预览"}</span></div>
          <div className="top-actions"><Button variant="text" icon="search" aria-label="全局搜索" onClick={() => showToast("搜索可按账号、IP 和服务名称定位数据")} /><Button variant="text" icon="contrast" aria-label="主题设置" onClick={() => setThemeOpen(true)} /><button className="notification-button" onClick={() => navigate("alerts")} aria-label={`${unacknowledgedAlerts} 条未确认告警`}><Icon name="notifications" /><span>{unacknowledgedAlerts}</span></button><button className="user-menu" aria-label="管理员菜单" onClick={() => setThemeOpen(true)}><span className="avatar avatar--small">C</span><div><strong>admin</strong><small>系统管理员</small></div><Icon name="arrow_drop_down" size={20} /></button></div>
        </header>
        <main id="main-content"><Suspense fallback={<PageLoading />}>{content}</Suspense></main>
      </div>

      <nav className="bottom-navigation" aria-label="手机导航">
        {navigation.slice(0, 4).map((item) => <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}><span><Icon name={item.icon} filled={page === item.id} /></span><small>{item.label}</small></button>)}
        <button className={!navigation.slice(0, 4).some((item) => item.id === page) ? "is-active" : ""} onClick={() => setDrawerOpen(true)}><span><Icon name="apps" filled={!navigation.slice(0, 4).some((item) => item.id === page)} /></span><small>更多</small></button>
      </nav>

      <ThemeDialog open={themeOpen} onClose={() => setThemeOpen(false)} mode={themeMode} color={themeColor} onMode={setThemeMode} onColor={setThemeColor} showSetup={showSetup} onShowSetup={setShowSetup} />
      <SetupWizard key={selectedSetup ?? "closed"} selected={selectedSetup} status={selectedSetup ? integrationFor(selectedSetup) : undefined} drafts={setupDrafts} onDraft={(id, field, value) => setSetupDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? {}), [field]: value } }))} onClose={() => setSelectedSetup(null)} onSave={saveIntegration} />
      <Dialog open={quotaOpen} onClose={() => setQuotaOpen(false)} title="设置月度总流量" description="用于总览、预计耗尽日期和流量阈值告警。" size="small" actions={<><Button variant="text" onClick={() => setQuotaOpen(false)}>取消</Button><Button onClick={() => { const value = Number(draftLimit); if (!Number.isFinite(value) || value <= 0) { showToast("请输入大于 0 的有效流量额度"); return; } const bytes = Math.round(value * 1024 ** 3); setDashboard((current) => ({ ...current, overview: { ...current.overview, trafficLimitBytes: bytes } })); void updateTrafficLimit(bytes).then(() => loadDashboard()).catch(() => undefined); setQuotaOpen(false); showToast("总流量额度已更新"); }}>保存</Button></>}><label className="field"><span>总流量（GB）</span><div className="field-with-suffix"><input type="number" min="1" value={draftLimit} onChange={(event) => setDraftLimit(event.target.value)} /><b>GB</b></div></label><p className="field-hint">该值保存在后端，用于剩余流量计算和告警，不会改变运营商实际限额。</p></Dialog>
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

function PageLoading() {
  return <div className="page-loading" role="status" aria-label="正在加载页面"><span /><span /><span /></div>;
}

function ThemeDialog({ open, onClose, mode, color, onMode, onColor, showSetup, onShowSetup }: { open: boolean; onClose: () => void; mode: ThemeMode; color: ThemeColor; onMode: (mode: ThemeMode) => void; onColor: (color: ThemeColor) => void; showSetup: boolean; onShowSetup: (visible: boolean) => void }) {
  const colors: Array<{ id: ThemeColor; label: string; value: string }> = [
    { id: "violet", label: "鸢尾紫", value: "#7357a3" }, { id: "blue", label: "海湾蓝", value: "#38618c" },
    { id: "green", label: "青苔绿", value: "#42664f" }, { id: "rose", label: "蔷薇红", value: "#88525f" }, { id: "amber", label: "琥珀金", value: "#7b5f21" },
  ];
  if (!open) return null;
  return <Dialog open={open} onClose={onClose} title="设置" description="管理 Material Design 3 外观和总览显示偏好。" actions={<Button onClick={onClose}>完成</Button>}><div className="theme-section"><h3>显示模式</h3><div className="theme-mode-grid">{(["light", "dark", "system"] as const).map((item) => <button key={item} className={mode === item ? "is-selected" : ""} onClick={() => onMode(item)}><span className={`theme-preview theme-preview--${item}`}><i /><i /><i /></span><div><Icon name={item === "light" ? "light_mode" : item === "dark" ? "dark_mode" : "desktop_windows"} size={19} />{item === "light" ? "浅色" : item === "dark" ? "深色" : "跟随系统"}</div></button>)}</div></div><div className="theme-section"><h3>主题色彩</h3><div className="color-options">{colors.map((item) => <button key={item.id} className={color === item.id ? "is-selected" : ""} onClick={() => onColor(item.id)}><span style={{ background: item.value }}>{color === item.id ? <Icon name="check" size={18} /> : null}</span><small>{item.label}</small></button>)}</div></div><div className="settings-row"><span><Icon name="checklist" /><span><strong>显示初始化向导</strong><small>在总览顶部显示数据接入进度。</small></span></span><button className={`md-switch ${showSetup ? "is-on" : ""}`} role="switch" aria-checked={showSetup} onClick={() => onShowSetup(!showSetup)}><span /></button></div><div className="theme-info"><Icon name="contrast" size={22} /><span>文字、图表和状态色会自动适配浅色与深色表面。</span></div></Dialog>;
}
