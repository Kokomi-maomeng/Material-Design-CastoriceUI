import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  auditEvents,
  demoNotice,
  initialAccounts,
  initialAlerts,
  initialConnections,
  initialSubscriptions,
  navigation,
  networkTargets,
  services,
} from "../lib/demo-data";
import type { Account, AlertItem, PageId, Subscription } from "../lib/types";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";

type ThemeMode = "light" | "dark" | "system";
type ThemeColor = "violet" | "blue" | "green" | "rose" | "amber";
const TRAFFIC_USED_BYTES = 366.2 * 1024 ** 3;
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
  const [trafficLimitGb, setTrafficLimitGb] = useState(500);
  const [draftLimit, setDraftLimit] = useState("500");
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(initialSubscriptions);
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connections, setConnections] = useState(initialConnections);

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
      setConnections((current) => current.map((item, index) => ({
        ...item,
        downloadBps: Math.max(1200, item.downloadBps * (0.91 + ((index * 17 + Date.now()) % 20) / 100)),
        uploadBps: Math.max(800, item.uploadBps * (0.9 + ((index * 11 + Date.now()) % 22) / 100)),
      })));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const content = useMemo(() => {
    switch (page) {
      case "accounts":
        return <AccountsPage accounts={accounts} onCreate={(account) => { setAccounts((current) => [...current, account]); showToast(`已创建演示账号 ${account.name}`); }} onToggle={(id) => { setAccounts((current) => current.map((account) => account.id === id ? { ...account, status: account.status === "disabled" ? "active" : "disabled", onlineDevices: account.status === "disabled" ? account.onlineDevices : 0 } : account)); showToast("账号状态已在演示数据中更新"); }} onResetPassword={(account) => showToast(`${account.name} 的密码重置需要后端确认`)} onToast={showToast} />;
      case "connections": return <ConnectionsPage connections={connections} now={now} onToast={showToast} />;
      case "traffic": return <TrafficPage onToast={showToast} />;
      case "subscriptions": return <SubscriptionsPage subscriptions={subscriptions} onToast={showToast} onRotate={(id) => { setSubscriptions((current) => current.map((item) => item.id === id ? { ...item, tokenHint: `new••••${Math.random().toString(36).slice(-4)}`, updatedAt: "刚刚" } : item)); showToast("演示订阅 Token 已重置"); }} />;
      case "network": return <NetworkPage targets={networkTargets} onToast={showToast} />;
      case "services": return <ServicesPage services={services} onToast={showToast} />;
      case "alerts": return <AlertsPage alerts={alerts} onAcknowledge={(id) => { setAlerts((current) => current.map((item) => item.id === id ? { ...item, acknowledged: true } : item)); showToast("告警已确认"); }} onToast={showToast} />;
      case "audit": return <AuditPage events={auditEvents} onToast={showToast} />;
      default: return <OverviewPage trafficUsed={TRAFFIC_USED_BYTES} trafficLimit={trafficLimitGb * 1024 ** 3} connections={connections} services={services} onEditQuota={() => { setDraftLimit(String(trafficLimitGb)); setQuotaOpen(true); }} onRefresh={() => { setNow(Date.now()); showToast("演示指标已刷新"); }} onViewServices={() => navigate("services")} />;
    }
  }, [accounts, alerts, connections, navigate, now, page, showToast, subscriptions, trafficLimitGb]);

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
        <div className="nav-footer"><div className="nav-status"><span className="status-dot status-dot--online" /><div><strong>东京节点</strong><span>运行正常 · 2.8 ms</span></div></div><button onClick={() => setThemeOpen(true)} aria-label="主题与外观" title="主题与外观"><Icon name="palette" /><span>主题与外观</span></button></div>
      </aside>
      {drawerOpen ? <button className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="关闭导航" /> : null}

      <div className="app-main">
        <header className="top-app-bar">
          <div className="top-app-bar__start"><Button variant="text" icon="menu" className="menu-button" aria-label="打开导航" onClick={() => setDrawerOpen(true)} /><div className="mobile-brand"><span className="brand-mark"><Icon name="ac_unit" size={21} filled /></span><strong>{pageTitle}</strong></div></div>
          <div className="demo-indicator"><Icon name="science" size={18} /><span>{demoNotice}</span></div>
          <div className="top-actions"><Button variant="text" icon="search" aria-label="全局搜索" onClick={() => showToast("全局搜索将在接入后端后启用")} /><Button variant="text" icon="contrast" aria-label="主题设置" onClick={() => setThemeOpen(true)} /><button className="notification-button" onClick={() => navigate("alerts")} aria-label={`${unacknowledgedAlerts} 条未确认告警`}><Icon name="notifications" /><span>{unacknowledgedAlerts}</span></button><button className="user-menu" aria-label="管理员菜单" onClick={() => showToast("账号设置将在接入认证后端后启用")}><span className="avatar avatar--small">C</span><div><strong>admin</strong><small>本地演示</small></div><Icon name="arrow_drop_down" size={20} /></button></div>
        </header>
        <main id="main-content"><Suspense fallback={<PageLoading />}>{content}</Suspense></main>
      </div>

      <nav className="bottom-navigation" aria-label="手机导航">
        {navigation.slice(0, 4).map((item) => <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => navigate(item.id)}><span><Icon name={item.icon} filled={page === item.id} /></span><small>{item.label}</small></button>)}
        <button className={!navigation.slice(0, 4).some((item) => item.id === page) ? "is-active" : ""} onClick={() => setDrawerOpen(true)}><span><Icon name="apps" filled={!navigation.slice(0, 4).some((item) => item.id === page)} /></span><small>更多</small></button>
      </nav>

      <ThemeDialog open={themeOpen} onClose={() => setThemeOpen(false)} mode={themeMode} color={themeColor} onMode={setThemeMode} onColor={setThemeColor} />
      <Dialog open={quotaOpen} onClose={() => setQuotaOpen(false)} title="设置月度总流量" description="用于总览、预测和告警百分比；实际计费值应由后端提供。" size="small" actions={<><Button variant="text" onClick={() => setQuotaOpen(false)}>取消</Button><Button onClick={() => { const value = Number(draftLimit); if (!Number.isFinite(value) || value <= 0) { showToast("请输入大于 0 的有效流量额度"); return; } setTrafficLimitGb(value); setQuotaOpen(false); showToast("总流量额度已更新"); }}>保存</Button></>}><label className="field"><span>总流量（GB）</span><div className="field-with-suffix"><input type="number" min="1" value={draftLimit} onChange={(event) => setDraftLimit(event.target.value)} /><b>GB</b></div></label><p className="field-hint">支持任意正数；正式接入时建议同时保存计费周期和重置时区。</p></Dialog>
      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  );
}

function PageLoading() {
  return <div className="page-loading" role="status" aria-label="正在加载页面"><span /><span /><span /></div>;
}

function ThemeDialog({ open, onClose, mode, color, onMode, onColor }: { open: boolean; onClose: () => void; mode: ThemeMode; color: ThemeColor; onMode: (mode: ThemeMode) => void; onColor: (color: ThemeColor) => void }) {
  const colors: Array<{ id: ThemeColor; label: string; value: string }> = [
    { id: "violet", label: "鸢尾紫", value: "#7357a3" }, { id: "blue", label: "海湾蓝", value: "#38618c" },
    { id: "green", label: "青苔绿", value: "#42664f" }, { id: "rose", label: "蔷薇红", value: "#88525f" }, { id: "amber", label: "琥珀金", value: "#7b5f21" },
  ];
  if (!open) return null;
  return <Dialog open={open} onClose={onClose} title="主题与外观" description="采用 Material Design 3 动态色彩和无障碍对比度。" actions={<Button onClick={onClose}>完成</Button>}><div className="theme-section"><h3>显示模式</h3><div className="theme-mode-grid">{(["light", "dark", "system"] as const).map((item) => <button key={item} className={mode === item ? "is-selected" : ""} onClick={() => onMode(item)}><span className={`theme-preview theme-preview--${item}`}><i /><i /><i /></span><div><Icon name={item === "light" ? "light_mode" : item === "dark" ? "dark_mode" : "desktop_windows"} size={19} />{item === "light" ? "浅色" : item === "dark" ? "深色" : "跟随系统"}</div></button>)}</div></div><div className="theme-section"><h3>主题色彩</h3><div className="color-options">{colors.map((item) => <button key={item.id} className={color === item.id ? "is-selected" : ""} onClick={() => onColor(item.id)}><span style={{ background: item.value }}>{color === item.id ? <Icon name="check" size={18} /> : null}</span><small>{item.label}</small></button>)}</div></div><div className="theme-info"><Icon name="contrast" size={22} /><span>文字、图表和状态色会自动适配浅色与深色表面。</span></div></Dialog>;
}
