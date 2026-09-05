import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  acknowledgeAlert,
  ApiError,
  completeInitialization,
  configureIntegration,
  fetchBootstrap,
  fetchDashboard,
  fetchSession,
  logout,
  updateTrafficLimit,
  updateUiSettings,
} from "../lib/api";
import { emptyDashboard } from "../lib/empty-dashboard";
import { useI18n } from "../lib/i18n";
import { navigation, PANEL_IDS } from "../lib/navigation";
import { readBooleanPreference, readPreference, writePreference } from "../lib/preferences";
import { THEME_COLORS, THEME_MODES, type ThemeColor, type ThemeMode } from "../lib/theme";
import type {
  AlertItem,
  BootstrapState,
  DashboardPayload,
  IntegrationId,
  PageId,
  SessionState,
  TrafficQuotaSettings,
} from "../lib/types";
import { AuthPage } from "./auth/AuthPage";
import { SettingsDialog, SettingsSwitch } from "./settings/SettingsDialog";

export { SettingsSwitch };
import { FirstRunConfiguration } from "./setup/FirstRunConfiguration";
import { SetupWizard } from "./setup/SetupWizard";
import { TrafficQuotaDialog } from "./traffic/TrafficQuotaDialog";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";

const PAGE_IDS = new Set<PageId>(navigation.map((item) => item.id));
const OverviewPage = lazy(() =>
  import("./pages/OverviewPage").then((module) => ({
    default: module.OverviewPage,
  })),
);
const AccountsPage = lazy(() =>
  import("./pages/AccountsPage").then((module) => ({
    default: module.AccountsPage,
  })),
);
const AlertsPage = lazy(() =>
  import("./pages/AlertsPage").then((module) => ({
    default: module.AlertsPage,
  })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })),
);
const ConnectionsPage = lazy(() =>
  import("./pages/ConnectionsPage").then((module) => ({
    default: module.ConnectionsPage,
  })),
);
const NetworkPage = lazy(() =>
  import("./pages/NetworkPage").then((module) => ({
    default: module.NetworkPage,
  })),
);
const ServicesPage = lazy(() =>
  import("./pages/ServicesPage").then((module) => ({
    default: module.ServicesPage,
  })),
);
const SubscriptionsPage = lazy(() =>
  import("./pages/SubscriptionsPage").then((module) => ({
    default: module.SubscriptionsPage,
  })),
);
const TrafficPage = lazy(() =>
  import("./pages/TrafficPage").then((module) => ({
    default: module.TrafficPage,
  })),
);
const SetupPage = lazy(() =>
  import("./pages/SetupPage").then((module) => ({ default: module.SetupPage })),
);

function pageFromHash(): PageId {
  const candidate = window.location.hash.replace(/^#\/?/, "") as PageId;
  return PAGE_IDS.has(candidate) ? candidate : "overview";
}

export function CastoriceApp() {
  const { language, t } = useI18n();
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [bootError, setBootError] = useState(false);
  const [page, setPage] = useState<PageId>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [desktopNavigationHidden, setDesktopNavigationHidden] = useState(() => readBooleanPreference("castorice-desktop-navigation-hidden", false));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readPreference("castorice-theme-mode", THEME_MODES, "system"),
  );
  const [themeColor, setThemeColor] = useState<ThemeColor>(() =>
    readPreference("castorice-theme-color", THEME_COLORS, "violet"),
  );
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connections, setConnections] = useState(emptyDashboard.connections);
  const [selectedSetup, setSelectedSetup] = useState<IntegrationId | null>(
    null,
  );
  const [setupDrafts, setSetupDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  const hasLiveData = useRef(false);
  const dashboardLoading = useRef(false);
  const toastSequence = useRef(0);
  const dateMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const start = useCallback(async () => {
    try {
      const state = await fetchBootstrap();
      setBootstrap(state);
      if (!state.setupRequired) {
        try {
          setSession(await fetchSession());
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 401)) throw error;
        }
      }
    } catch {
      setBootError(true);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void start(), 0);
    return () => window.clearTimeout(timer);
  }, [start]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved =
        themeMode === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : themeMode;
      root.dataset.theme = resolved;
      root.dataset.themeColor = themeColor;
      root.style.colorScheme = resolved;
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", apply);
    writePreference("castorice-theme-mode", themeMode);
    writePreference("castorice-theme-color", themeColor);
    return () => media.removeEventListener?.("change", apply);
  }, [themeColor, themeMode]);
  useEffect(() => {
    writePreference("castorice-desktop-navigation-hidden", String(desktopNavigationHidden));
  }, [desktopNavigationHidden]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const closeFloatingMenus = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!dateMenuRef.current?.contains(target)) setDateOpen(false);
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDateOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeFloatingMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFloatingMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* Clear the local state even if the session already expired. */
    }
    setSession(null);
    setDashboard(emptyDashboard);
    setAlerts([]);
    setConnections([]);
    hasLiveData.current = false;
    setUserMenuOpen(false);
    try {
      setBootstrap(await fetchBootstrap());
    } catch {
      setBootError(true);
    }
    window.history.replaceState(null, "", "#/overview");
  }, []);
  const loadDashboard = useCallback(async () => {
    if (!session || dashboardLoading.current) return;
    dashboardLoading.current = true;
    try {
      const payload = await fetchDashboard();
      setDashboard({ ...payload, mode: "live" });
      setAlerts(payload.alerts);
      setConnections(payload.connections);
      hasLiveData.current = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await signOut();
        return;
      }
      if (hasLiveData.current)
        setDashboard((current) => ({ ...current, mode: "stale" }));
      else
        setDashboard((current) => ({ ...current, mode: "error" }));
    } finally {
      dashboardLoading.current = false;
    }
  }, [session, signOut]);
  useEffect(() => {
    if (!session) return;
    const initial = window.setTimeout(() => void loadDashboard(), 0);
    const timer = window.setInterval(() => void loadDashboard(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadDashboard, session]);
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

  const uiSettings = dashboard.uiSettings ?? {
    showSetup: true,
    visiblePanels: PANEL_IDS,
    panelTitle: "CastoriceUI",
    idleTimeoutMinutes: 15,
  };
  useEffect(() => {
    if (!session) return;
    let timeout = 0;
    const schedule = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(
        () => void signOut(),
        uiSettings.idleTimeoutMinutes * 60_000,
      );
    };
    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "scroll",
    ];
    schedule();
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, schedule, {
        passive: true,
        capture: eventName === "scroll",
      }),
    );
    return () => {
      window.clearTimeout(timeout);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, schedule, eventName === "scroll"),
      );
    };
  }, [session, signOut, uiSettings.idleTimeoutMinutes]);
  const visiblePanels =
    dashboard.mode === "live" ? uiSettings.visiblePanels : PANEL_IDS;
  const visibleNavigation = useMemo(
    () =>
      navigation.filter((item) =>
        item.id === "overview" || item.id === "setup"
          ? item.id !== "setup" || uiSettings.showSetup
          : visiblePanels.includes(item.id),
      ),
    [uiSettings.showSetup, visiblePanels],
  );
  const labelFor = useCallback(
    (id: PageId) => {
      const item = navigation.find((candidate) => candidate.id === id);
      return item ? t(item.labelZh, item.labelEn) : t("总览", "Overview");
    },
    [t],
  );
  const pageTitle = labelFor(page);
  const unacknowledgedAlerts = alerts.filter(
    (item) => !item.acknowledged,
  ).length;
  const navigate = useCallback((id: PageId) => {
    setPage(id);
    setDrawerOpen(false);
    const nextHash = `#/${id}`;
    if (window.location.hash !== nextHash)
      window.history.pushState(null, "", nextHash);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);
  useEffect(() => {
    // Sidebar visibility is a presentation preference; overview shortcuts and
    // browser history must still be able to open a hidden destination.
    if (page !== "setup" || uiSettings.showSetup) return;
    const timer = window.setTimeout(() => navigate("overview"), 0);
    return () => window.clearTimeout(timer);
  }, [navigate, page, uiSettings.showSetup]);
  const showToast = useCallback((message: string) => {
    toastSequence.current += 1;
    setToast({ id: toastSequence.current, message });
  }, []);
  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);
  const integrationFor = useCallback(
    (id: IntegrationId) =>
      dashboard.integrations.find((item) => item.id === id),
    [dashboard.integrations],
  );
  const configurePage = useCallback(
    (id: IntegrationId) => {
      const currentValues = integrationFor(id)?.values ?? {};
      setSetupDrafts((current) => ({
        ...current,
        [id]: { ...currentValues, ...(current[id] ?? {}) },
      }));
      if (id === "network")
        setSetupDrafts((current) => ({
          ...current,
          network: {
            ...current.network,
            targets: dashboard.networkTargets
              .map((target) => `${target.name},${target.address}`)
              .join("\n"),
          },
        }));
      setSelectedSetup(id);
    },
    [dashboard.networkTargets, integrationFor],
  );
  const openQuota = useCallback(() => {
    setQuotaOpen(true);
  }, []);
  const saveQuota = useCallback(async (settings: Pick<TrafficQuotaSettings, "bytes" | "autoReset" | "periodUnit" | "periodCount" | "resetAnchor" | "resetTime" | "timezone">) => {
    await updateTrafficLimit(settings);
    setDashboard((current) => ({
      ...current,
      overview: { ...current.overview, trafficLimitBytes: settings.bytes },
      accounts: current.accounts.map((account) => ({ ...account, quotaBytes: settings.bytes })),
    }));
    await loadDashboard();
  }, [loadDashboard]);
  const saveIntegration = useCallback(
    async (id: IntegrationId, values: Record<string, string>) => {
      try {
        const saved = await configureIntegration(id, true, values);
        const payload = await fetchDashboard();
        setDashboard({ ...payload, mode: "live" });
        setAlerts(payload.alerts);
        setConnections(payload.connections);
        hasLiveData.current = true;
        const verified = payload.integrations.find((item) => item.id === id) ?? saved;
        if (id === "subscriptions") {
          setSetupDrafts((current) => ({ ...current, subscriptions: {} }));
        }
        showToast(verified.status === "ready"
          ? t("配置已保存并通过实际运行验证", "Configuration saved and live-verified")
          : t("配置已保存，但实际运行状态仍需检查", "Configuration saved, but the live status still needs attention"));
        return verified;
      } catch (error) {
        await loadDashboard();
        showToast(id === "subscriptions"
          ? t("订阅实际访问验证失败，配置未保存", "Live subscription probe failed; configuration was not saved")
          : t("后端实际验证失败，配置未保存", "Backend live validation failed; configuration was not saved"));
        throw error;
      }
    },
    [loadDashboard, showToast, t],
  );

  if (bootError)
    return (
      <main className="boot-state">
        <Icon name="cloud_off" size={40} />
        <h1>{t("无法连接面板后端", "Unable to reach the panel backend")}</h1>
        <p>
          {t(
            "没有显示任何示例数据。请检查后端服务和反向代理后重试。",
            "No sample data is shown. Check the backend service and reverse proxy, then retry.",
          )}
        </p>
        <Button
          icon="refresh"
          onClick={() => {
            setBootError(false);
            void start();
          }}
        >
          {t("重试", "Retry")}
        </Button>
      </main>
    );
  if (!bootstrap) return <PageLoading />;
  if (!session)
    return (
      <AuthPage
        bootstrap={bootstrap}
        onAuthenticated={(next) => {
          setSession(next);
          setBootstrap((current) =>
            current ? { ...current, setupRequired: false } : current,
          );
        }}
      />
    );
  if (dashboard.mode === "loading") return <PageLoading />;
  if (dashboard.mode === "error")
    return (
      <main className="boot-state">
        <Icon name="monitor_heart" size={40} />
        <h1>{t("仪表盘数据暂时不可用", "Dashboard data is temporarily unavailable")}</h1>
        <p>{t("后端已连接，但实时采集失败。请检查网卡配置和后端日志后重试；页面不会显示伪造的零值。", "The backend is reachable, but live collection failed. Check the interface configuration and backend log, then retry; the page will not display fabricated zero values.")}</p>
        <Button icon="refresh" onClick={() => void loadDashboard()}>{t("重试", "Retry")}</Button>
      </main>
    );
  if (!session.setupComplete)
    return (
      <>
        <FirstRunConfiguration
          metrics={dashboard.overview}
          integrations={dashboard.integrations}
          onConfigure={configurePage}
          onSaveBasics={async (nodeName, quotaGb) => {
            await saveIntegration("system", { nodeName });
            await saveIntegration("traffic", { quotaGb });
          }}
          onComplete={async () => {
            await completeInitialization();
            setSession((current) =>
              current ? { ...current, setupComplete: true } : current,
            );
            navigate("overview");
          }}
        />
        <SetupWizard
          key={`setup-${selectedSetup ?? "closed"}`}
          selected={selectedSetup}
          status={selectedSetup ? integrationFor(selectedSetup) : undefined}
          drafts={setupDrafts}
          onDraft={(id, field, value) =>
            setSetupDrafts((current) => ({
              ...current,
              [id]: { ...(current[id] ?? {}), [field]: value },
            }))
          }
          onClose={() => setSelectedSetup(null)}
          onSave={saveIntegration}
        />
        <Toast key={`toast-${toast?.id ?? "closed"}`} message={toast?.message ?? null} onDismiss={dismissToast} />
      </>
    );

  const content = (() => {
    switch (page) {
      case "setup":
        return (
          <SetupPage
            statuses={dashboard.integrations}
            onOpen={configurePage}
          />
        );
      case "accounts":
        return (
          <AccountsPage
            accounts={dashboard.accounts}
            integration={integrationFor("hysteria2")}
            onConfigure={() => configurePage("hysteria2")}
          />
        );
      case "connections":
        return (
          <ConnectionsPage
            connections={connections}
            now={now}
            onToast={showToast}
            integration={integrationFor("connections")}
            onConfigure={() => configurePage("connections")}
          />
        );
      case "traffic":
        return (
          <TrafficPage
            traffic={dashboard.traffic}
            integration={integrationFor("traffic")}
            onConfigure={() => configurePage("traffic")}
          />
        );
      case "subscriptions":
        return (
          <SubscriptionsPage
            subscriptions={dashboard.subscriptions}
            onToast={showToast}
          />
        );
      case "network":
        return (
          <NetworkPage
            targets={dashboard.networkTargets}
            onToast={showToast}
            integration={integrationFor("network")}
            onConfigure={() => configurePage("network")}
            onSaved={loadDashboard}
          />
        );
      case "services":
        return (
          <ServicesPage
            services={dashboard.services}
            metrics={dashboard.overview}
            onRefresh={() => {
              void loadDashboard();
              showToast(t("正在重新读取服务状态", "Refreshing service status"));
            }}
          />
        );
      case "alerts":
        return (
          <AlertsPage
            alerts={alerts}
            integration={integrationFor("alerts")}
            onConfigure={() => configurePage("alerts")}
            onAcknowledge={async (id) => {
              try {
                await acknowledgeAlert(id);
                setAlerts((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, acknowledged: true } : item,
                  ),
                );
                showToast(t("告警已确认", "Alert acknowledged"));
              } catch {
                showToast(t("告警确认失败，请重试", "Unable to acknowledge the alert. Try again."));
              }
            }}
            onToast={showToast}
          />
        );
      case "audit":
        return (
          <AuditPage />
        );
      default:
        return (
          <OverviewPage
            mode={dashboard.mode}
            metrics={dashboard.overview}
            connections={connections}
            services={dashboard.services}
            networkTargets={dashboard.networkTargets}
            traffic={dashboard.traffic}
            onEditQuota={openQuota}
            onRefresh={() => {
              void loadDashboard();
              showToast(t("正在刷新实时数据", "Refreshing live data"));
            }}
            onNavigate={navigate}
          />
        );
    }
  })();

  return (
    <div className={`app-shell ${desktopNavigationHidden ? "app-shell--navigation-hidden" : ""}`}>
      <aside className={`navigation-rail ${drawerOpen ? "is-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="ac_unit" size={25} filled />
          </span>
          <div>
            <strong>{uiSettings.panelTitle || "CastoriceUI"}</strong>
            <span>VPS Console</span>
          </div>
        </div>
        <nav aria-label={t("主导航", "Primary navigation")}>
          {visibleNavigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              aria-label={t(item.labelZh, item.labelEn)}
              title={t(item.labelZh, item.labelEn)}
            >
              <Icon name={item.icon} filled={page === item.id} />
              <span>{t(item.labelZh, item.labelEn)}</span>
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label={t("设置", "Settings")}
            title={t("设置", "Settings")}
          >
            <Icon name="settings" />
            <span>{t("设置", "Settings")}</span>
          </button>
        </div>
      </aside>
      {drawerOpen ? (
        <button
          className="drawer-scrim"
          onClick={() => setDrawerOpen(false)}
          aria-label={t("关闭导航", "Close navigation")}
        />
      ) : null}
      <div className="app-main">
        <header className="top-app-bar">
          <div className="top-app-bar__start">
            <Button
              variant="text"
              icon={desktopNavigationHidden ? "left_panel_open" : "left_panel_close"}
              className="desktop-navigation-toggle"
              aria-label={desktopNavigationHidden ? t("显示侧边栏", "Show sidebar") : t("隐藏侧边栏", "Hide sidebar")}
              title={desktopNavigationHidden ? t("显示侧边栏", "Show sidebar") : t("隐藏侧边栏", "Hide sidebar")}
              onClick={() => setDesktopNavigationHidden((hidden) => !hidden)}
            />
            <Button
              variant="text"
              icon="menu"
              className="menu-button"
              aria-label={t("打开导航", "Open navigation")}
              onClick={() => setDrawerOpen(true)}
            />
            <div className="mobile-brand">
              <span className="brand-mark">
                <Icon name="ac_unit" size={21} filled />
              </span>
              <strong>{pageTitle}</strong>
            </div>
          </div>
          <div aria-hidden="true" />
          <div className="top-actions">
            <div className="snapshot-time-wrap" ref={dateMenuRef}>
              <button className="snapshot-time" onClick={() => setDateOpen((open) => !open)} aria-expanded={dateOpen} aria-label={t("显示本地日期", "Show local date")}>
                <time dateTime={new Date(now).toISOString()}>{new Date(now).toLocaleTimeString(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" })}</time>
              </button>
              <div className={`snapshot-date floating-surface ${dateOpen ? "is-open" : ""}`} role="status" aria-hidden={!dateOpen}>{new Date(now).toLocaleDateString("en-CA").replaceAll("-", "")}</div>
            </div>
            <button
              className="notification-button"
              onClick={() => navigate("alerts")}
              aria-label={t(
                `${unacknowledgedAlerts} 条未确认告警`,
                `${unacknowledgedAlerts} unacknowledged alerts`,
              )}
            >
              <Icon name="notifications" />
              {unacknowledgedAlerts > 0 ? (
                <span className="notification-badge">
                  {unacknowledgedAlerts > 99 ? "99+" : unacknowledgedAlerts}
                </span>
              ) : null}
            </button>
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                className="user-menu"
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="avatar avatar--small">
                  {session.username.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{session.username}</strong>
                  <small>{t("已登录", "Signed in")}</small>
                </div>
                <Icon
                  name={userMenuOpen ? "expand_less" : "expand_more"}
                  size={18}
                />
              </button>
                <div className={`user-popover floating-surface ${userMenuOpen ? "is-open" : ""}`} role="menu" aria-hidden={!userMenuOpen}>
                  <button role="menuitem" onClick={() => void signOut()}>
                    <Icon name="logout" size={19} />
                    {t("注销", "Sign out")}
                  </button>
                </div>
            </div>
          </div>
        </header>
        <main id="main-content">
          {dashboard.mode === "stale" ? (
            <div className="preview-mode-banner" role="alert">
              <Icon name="cloud_off" size={21} />
              <div>
                <strong>
                  {t(
                    "后端连接中断，数据已停止更新",
                    "Backend disconnected; data is no longer updating",
                  )}
                </strong>
                <span>
                  {t(
                    `页面保留 ${new Date(dashboard.generatedAt).toLocaleString("zh-CN")} 的最后一次真实快照。`,
                    `The page retains the last real snapshot from ${new Date(dashboard.generatedAt).toLocaleString("en")}.`,
                  )}
                </span>
              </div>
            </div>
          ) : null}
          <Suspense fallback={<PageLoading />}>{content}</Suspense>
        </main>
      </div>
      {settingsOpen ? (
        <SettingsDialog
          open
          onClose={() => setSettingsOpen(false)}
          mode={themeMode}
          color={themeColor}
          onMode={setThemeMode}
          onColor={setThemeColor}
          uiSettings={uiSettings}
          onUiSettings={async (next) => {
            try {
              const saved = await updateUiSettings(next);
              setDashboard((current) => ({ ...current, uiSettings: saved }));
              showToast(t("面板设置已保存", "Panel settings saved"));
            } catch (error) {
              showToast(t("面板设置保存失败，请检查后端连接", "Unable to save panel settings. Check the backend connection."));
              throw error;
            }
          }}
          nodeName={dashboard.overview.nodeName}
          trafficLimitBytes={dashboard.overview.trafficLimitBytes}
          onEditQuota={openQuota}
          onSaveNodeName={async (nodeName) => {
            await saveIntegration("system", { nodeName });
          }}
          onToast={showToast}
        />
      ) : null}
      <SetupWizard
        key={`setup-${selectedSetup ?? "closed"}`}
        selected={selectedSetup}
        status={selectedSetup ? integrationFor(selectedSetup) : undefined}
        drafts={setupDrafts}
        onDraft={(id, field, value) =>
          setSetupDrafts((current) => ({
            ...current,
            [id]: { ...(current[id] ?? {}), [field]: value },
          }))
        }
        onClose={() => setSelectedSetup(null)}
        onSave={saveIntegration}
      />
      {quotaOpen ? <TrafficQuotaDialog
        trafficLimitBytes={dashboard.overview.trafficLimitBytes}
        quota={dashboard.overview.trafficQuota}
        onClose={() => setQuotaOpen(false)}
        onSave={saveQuota}
        onToast={showToast}
      /> : null}
      <Toast key={`toast-${toast?.id ?? "closed"}`} message={toast?.message ?? null} onDismiss={dismissToast} />
    </div>
  );
}

function PageLoading() {
  const { t } = useI18n();
  return (
    <div
      className="page-loading"
      role="status"
      aria-label={t("正在加载页面", "Loading page")}
    >
      <span />
      <span />
      <span />
    </div>
  );
}
