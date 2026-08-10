import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyDashboard,
  navigation,
  previewDashboard,
} from "../lib/demo-data";
import { acknowledgeAlert, configureIntegration, fetchDashboard, updateTrafficLimit } from "../lib/api";
import type { AlertItem, DashboardPayload, IntegrationId, PageId } from "../lib/types";
import { SetupWizard } from "./setup/SetupWizard";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";

type ThemeMode = "light" | "dark" | "system";
type ThemeColor = "violet" | "blue" | "green" | "rose" | "amber" | "teal" | "cyan" | "indigo" | "coral" | "slate";
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_COLORS: ThemeColor[] = ["violet", "blue", "green", "rose", "amber", "teal", "cyan", "indigo", "coral", "slate"];
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
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readPreference("castorice-theme-mode", THEME_MODES, "system"));
  const [themeColor, setThemeColor] = useState<ThemeColor>(() => readPreference("castorice-theme-color", THEME_COLORS, "violet"));
  const [showSetup, setShowSetup] = useState(() => readPreference("castorice-setup-panel", ["show", "hide"], "show") === "show");
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [backendOnline, setBackendOnline] = useState(false);
  const [draftLimit, setDraftLimit] = useState("0");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connections, setConnections] = useState(emptyDashboard.connections);
  const [selectedSetup, setSelectedSetup] = useState<IntegrationId | null>(null);
  const [setupDrafts, setSetupDrafts] = useState<Record<string, Record<string, string>>>({});
  const hasLiveData = useRef(false);

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
      setDashboard({ ...payload, mode: "live" });
      setAlerts(payload.alerts);
      setConnections(payload.connections);
      setBackendOnline(true);
      hasLiveData.current = true;
    } catch {
      setBackendOnline(false);
      if (hasLiveData.current) {
        setDashboard((current) => ({ ...current, mode: "stale" }));
      } else {
        setAlerts(previewDashboard.alerts);
        setConnections(previewDashboard.connections);
        setDashboard({ ...previewDashboard, generatedAt: new Date().toISOString() });
      }
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
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const closeQuota = useCallback(() => setQuotaOpen(false), []);
  const openQuota = useCallback(() => {
    setDraftLimit(String(Math.round(dashboard.overview.trafficLimitBytes / 1024 ** 3)));
    setQuotaOpen(true);
  }, [dashboard.overview.trafficLimitBytes]);
  const saveQuota = useCallback(async () => {
    const value = Number(draftLimit);
    if (!Number.isFinite(value) || value <= 0) {
      showToast("请输入大于 0 的有效流量额度");
      return;
    }
    const bytes = Math.round(value * 1024 ** 3);
    setQuotaSaving(true);
    try {
      await updateTrafficLimit(bytes);
      setDashboard((current) => ({ ...current, overview: { ...current.overview, trafficLimitBytes: bytes } }));
      setQuotaOpen(false);
      showToast("总流量额度已保存");
      await loadDashboard();
    } catch {
      showToast("保存失败，请检查后端连接");
    } finally {
      setQuotaSaving(false);
    }
  }, [draftLimit, loadDashboard, showToast]);
  const saveIntegration = useCallback(async (id: IntegrationId, values: Record<string, string>) => {
    try {
      await configureIntegration(id, true, values);
      await loadDashboard();
      showToast(id === "hysteria2" || id === "anytls" ? "配置已保存，协议接口连通与鉴权验证通过" : "配置已保存；运行状态以页面采集结果为准");
    } catch (error) {
      if (dashboard.mode !== "preview") {
        showToast("验证失败；配置未保存，请检查回环地址、Secret 和后端日志");
        throw error;
      }
      setDashboard((current) => ({ ...current, integrations: current.integrations.map((item) => item.id === id ? { ...item, enabled: true, configured: true, status: "preview", summary: "仅完成界面演示，未连接或验证后端" } : item) }));
      showToast("演示流程已完成；没有保存配置，也没有验证真实服务");
    }
  }, [dashboard.mode, loadDashboard, showToast]);

  const content = useMemo(() => {
    switch (page) {
      case "accounts":
        return <AccountsPage accounts={dashboard.accounts} integration={integrationFor("hysteria2")} onConfigure={() => configurePage("hysteria2")} />;
      case "connections": return <ConnectionsPage connections={connections} now={now} onToast={showToast} integration={integrationFor("connections")} onConfigure={() => configurePage("connections")} />;
      case "traffic": return <TrafficPage onToast={showToast} traffic={dashboard.traffic} integration={integrationFor("traffic")} onConfigure={() => configurePage("traffic")} />;
      case "subscriptions": return <SubscriptionsPage subscriptions={dashboard.subscriptions} integration={integrationFor("subscriptions")} onConfigure={() => configurePage("subscriptions")} onToast={showToast} />;
      case "network": return <NetworkPage targets={dashboard.networkTargets} onToast={showToast} integration={integrationFor("network")} onConfigure={() => configurePage("network")} />;
      case "services": return <ServicesPage services={dashboard.services} metrics={dashboard.overview} onRefresh={() => { void loadDashboard(); showToast("正在重新读取服务状态"); }} integration={integrationFor("system")} onConfigure={() => configurePage("system")} />;
      case "alerts": return <AlertsPage alerts={alerts} integration={integrationFor("alerts")} onConfigure={() => configurePage("alerts")} onAcknowledge={(id) => { setAlerts((current) => current.map((item) => item.id === id ? { ...item, acknowledged: true } : item)); void acknowledgeAlert(id).catch(() => undefined); showToast("告警已确认"); }} onToast={showToast} />;
      case "audit": return <AuditPage events={dashboard.auditEvents} integration={integrationFor("audit")} onConfigure={() => configurePage("audit")} />;
      default: return <OverviewPage mode={dashboard.mode} metrics={dashboard.overview} connections={connections} services={dashboard.services} networkTargets={dashboard.networkTargets} integrations={dashboard.integrations} resourceHistory={dashboard.resourceHistory} showSetup={showSetup} onOpenSetup={configurePage} onEditQuota={openQuota} onRefresh={() => { void loadDashboard(); showToast(dashboard.mode === "preview" ? "正在尝试连接后端；失败时继续显示明确标注的示例数据" : "正在刷新后端快照"); }} onViewServices={() => navigate("services")} />;
    }
  }, [alerts, configurePage, connections, dashboard, integrationFor, loadDashboard, navigate, now, openQuota, page, showSetup, showToast]);

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
        <div className="nav-footer"><button onClick={() => setThemeOpen(true)} aria-label="主题与外观" title="主题与外观"><Icon name="palette" /><span>主题与外观</span></button><div className="nav-status"><span className={`status-dot ${backendOnline ? "status-dot--online" : "status-dot--warning"}`} /><div><strong>{dashboard.mode === "live" ? `后端快照 · ${new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : dashboard.mode === "stale" ? `数据已停止更新 · ${new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : dashboard.mode === "loading" ? "正在连接后端" : "明确标注的示例数据"}</strong><span>{dashboard.overview.nodeName}</span></div></div><button onClick={() => setShowSetup((visible) => !visible)} aria-label={showSetup ? "隐藏初始化向导" : "显示初始化向导"} title={showSetup ? "隐藏初始化向导" : "显示初始化向导"}><Icon name={showSetup ? "checklist" : "playlist_add_check"} /><span>{showSetup ? "隐藏初始化向导" : "显示初始化向导"}</span></button></div>
      </aside>
      {drawerOpen ? <button className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="关闭导航" /> : null}

      <div className="app-main">
        <header className="top-app-bar">
          <div className="top-app-bar__start"><Button variant="text" icon="menu" className="menu-button" aria-label="打开导航" onClick={() => setDrawerOpen(true)} /><div className="mobile-brand"><span className="brand-mark"><Icon name="ac_unit" size={21} filled /></span><strong>{pageTitle}</strong></div></div>
          <div aria-hidden="true" />
          <div className="top-actions"><Button variant="text" icon="contrast" aria-label="主题设置" onClick={() => setThemeOpen(true)} /><button className="notification-button" onClick={() => navigate("alerts")} aria-label={`${unacknowledgedAlerts} 条未确认告警`}><Icon name="notifications" /><span>{unacknowledgedAlerts}</span></button><div className="user-menu" aria-label="当前管理员"><span className="avatar avatar--small">C</span><div><strong>admin</strong><small>系统管理员</small></div></div></div>
        </header>
        <main id="main-content">
          {dashboard.mode === "preview" && !backendOnline ? <div className="preview-mode-banner" role="status"><Icon name="science" size={21} /><div><strong>示例数据模式</strong><span>当前数字、连接、服务状态和配置结果均为界面演示，不代表任何服务器已经接入或验证。</span></div></div> : null}
          {dashboard.mode === "stale" ? <div className="preview-mode-banner" role="alert"><Icon name="cloud_off" size={21} /><div><strong>后端连接中断，数据已停止更新</strong><span>页面保留的是 {new Date(dashboard.generatedAt).toLocaleString()} 最后一次成功快照，不是当前实时状态。</span></div></div> : null}
          {dashboard.mode === "loading" ? <PageLoading /> : <Suspense fallback={<PageLoading />}>{content}</Suspense>}
        </main>
      </div>

      <nav className="bottom-navigation" aria-label="手机导航">
        {navigation.slice(0, 4).map((item) => <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}><span><Icon name={item.icon} filled={page === item.id} /></span><small>{item.label}</small></button>)}
        <button className={!navigation.slice(0, 4).some((item) => item.id === page) ? "is-active" : ""} onClick={() => setDrawerOpen(true)}><span><Icon name="apps" filled={!navigation.slice(0, 4).some((item) => item.id === page)} /></span><small>更多</small></button>
      </nav>

      <ThemeDialog open={themeOpen} onClose={closeTheme} mode={themeMode} color={themeColor} onMode={setThemeMode} onColor={setThemeColor} showSetup={showSetup} onShowSetup={setShowSetup} />
      <SetupWizard key={selectedSetup ?? "closed"} selected={selectedSetup} status={selectedSetup ? integrationFor(selectedSetup) : undefined} preview={dashboard.mode === "preview"} drafts={setupDrafts} onDraft={(id, field, value) => setSetupDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? {}), [field]: value } }))} onClose={() => setSelectedSetup(null)} onSave={saveIntegration} />
      <Dialog open={quotaOpen} onClose={closeQuota} title="设置月度总流量" description="用于总览、预计耗尽日期和流量阈值告警。" size="small" actions={<><Button variant="text" onClick={closeQuota} disabled={quotaSaving}>取消</Button><Button onClick={() => void saveQuota()} disabled={quotaSaving}>{quotaSaving ? "保存中…" : "保存"}</Button></>}><label className="field"><span>总流量（GB）</span><div className="field-with-suffix"><input type="number" min="1" step="1" inputMode="numeric" value={draftLimit} onChange={(event) => setDraftLimit(event.target.value)} autoComplete="off" /><b>GB</b></div></label><p className="field-hint">输入期间实时刷新不会覆盖该字段；保存成功后才更新后端额度。</p></Dialog>
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
    { id: "teal", label: "深海青", value: "#006a6a" }, { id: "cyan", label: "冰川青", value: "#00677c" },
    { id: "indigo", label: "群青蓝", value: "#4b5f9e" }, { id: "coral", label: "珊瑚橙", value: "#9b442a" }, { id: "slate", label: "岩灰蓝", value: "#52606f" },
  ];
  if (!open) return null;
  return <Dialog open={open} onClose={onClose} title="设置" description="管理 Material Design 3 外观和总览显示偏好。" actions={<Button onClick={onClose}>完成</Button>}><div className="theme-section"><h3>显示模式</h3><div className="theme-mode-grid">{(["light", "dark", "system"] as const).map((item) => <button key={item} className={mode === item ? "is-selected" : ""} onClick={() => onMode(item)}><span className={`theme-preview theme-preview--${item}`}><i /><i /><i /></span><div><Icon name={item === "light" ? "light_mode" : item === "dark" ? "dark_mode" : "desktop_windows"} size={19} />{item === "light" ? "浅色" : item === "dark" ? "深色" : "跟随系统"}</div></button>)}</div></div><div className="theme-section"><h3>主题色彩</h3><div className="color-options">{colors.map((item) => <button key={item.id} className={color === item.id ? "is-selected" : ""} onClick={() => onColor(item.id)}><span style={{ background: item.value }}>{color === item.id ? <Icon name="check" size={18} /> : null}</span><small>{item.label}</small></button>)}</div></div><button className="settings-row settings-row--button" role="switch" aria-checked={showSetup} onClick={() => onShowSetup(!showSetup)}><span><Icon name="checklist" /><span><strong>显示初始化向导</strong><small>点击整行即可在总览显示或隐藏。</small></span></span><span className={`md-switch ${showSetup ? "is-on" : ""}`} aria-hidden="true"><span /></span><b>{showSetup ? "已显示" : "已隐藏"}</b></button><div className="theme-info"><Icon name="contrast" size={22} /><span>文字、图表和状态色会自动适配浅色与深色表面。</span></div></Dialog>;
}
