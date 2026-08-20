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
  fetchBackgroundOptions,
  fetchBootstrap,
  fetchDashboard,
  fetchSession,
  logout,
  updateLoginBackground,
  updateTrafficLimit,
  updateUiSettings,
} from "../lib/api";
import { emptyDashboard } from "../lib/empty-dashboard";
import { formatDecimalBytes } from "../lib/format";
import { useI18n, type LanguagePreference } from "../lib/i18n";
import { navigation } from "../lib/navigation";
import type {
  AlertItem,
  BootstrapState,
  DashboardPayload,
  IntegrationId,
  PageId,
  SessionState,
  UiSettings,
} from "../lib/types";
import { AuthPage } from "./auth/AuthPage";
import { FirstRunConfiguration } from "./setup/FirstRunConfiguration";
import { SetupWizard } from "./setup/SetupWizard";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";

type ThemeMode = "light" | "dark" | "system";
type ThemeColor =
  | "violet"
  | "blue"
  | "green"
  | "rose"
  | "amber"
  | "teal"
  | "cyan"
  | "indigo"
  | "coral"
  | "slate";
const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
const THEME_COLORS: ThemeColor[] = [
  "violet",
  "blue",
  "green",
  "rose",
  "amber",
  "teal",
  "cyan",
  "indigo",
  "coral",
  "slate",
];
const PANEL_IDS: PageId[] = [
  "accounts",
  "connections",
  "traffic",
  "subscriptions",
  "network",
  "services",
  "alerts",
  "audit",
];
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

function readPreference<T extends string>(
  key: string,
  allowed: T[],
  fallback: T,
): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Applies for this tab. */
  }
}
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [quotaSaving, setQuotaSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readPreference("castorice-theme-mode", THEME_MODES, "system"),
  );
  const [themeColor, setThemeColor] = useState<ThemeColor>(() =>
    readPreference("castorice-theme-color", THEME_COLORS, "violet"),
  );
  const [dashboard, setDashboard] = useState<DashboardPayload>(emptyDashboard);
  const [backendOnline, setBackendOnline] = useState(false);
  const [draftLimit, setDraftLimit] = useState("1");
  const [draftQuotaAutoReset, setDraftQuotaAutoReset] = useState(false);
  const [draftQuotaUnit, setDraftQuotaUnit] = useState<"day" | "week" | "month" | "year">("month");
  const [draftQuotaCount, setDraftQuotaCount] = useState("1");
  const [draftQuotaAnchor, setDraftQuotaAnchor] = useState("2000-01-01");
  const [draftQuotaTimezone, setDraftQuotaTimezone] = useState("UTC");
  const [quotaError, setQuotaError] = useState("");
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
      setBackendOnline(true);
      hasLiveData.current = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await signOut();
        return;
      }
      setBackendOnline(false);
      if (hasLiveData.current)
        setDashboard((current) => ({ ...current, mode: "stale" }));
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
    if (visibleNavigation.some((item) => item.id === page)) return;
    const timer = window.setTimeout(() => navigate("overview"), 0);
    return () => window.clearTimeout(timer);
  }, [navigate, page, visibleNavigation]);
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
    [dashboard.networkTargets],
  );
  const openQuota = useCallback(() => {
    const quota = dashboard.overview.trafficQuota;
    setDraftLimit(
      String(
        Math.max(
          1,
          Math.round(dashboard.overview.trafficLimitBytes / 1_000_000_000),
        ),
      ),
    );
    setDraftQuotaAutoReset(quota?.autoReset ?? false);
    setDraftQuotaUnit(quota?.periodUnit ?? "month");
    setDraftQuotaCount(String(quota?.periodCount ?? 1));
    setDraftQuotaAnchor(quota?.resetAnchor ?? new Date().toISOString().slice(0, 10));
    setDraftQuotaTimezone(quota?.timezone ?? "UTC");
    setQuotaError("");
    setQuotaOpen(true);
  }, [dashboard.overview.trafficLimitBytes, dashboard.overview.trafficQuota]);
  const saveQuota = useCallback(async () => {
    const value = Number(draftLimit);
    const periodCount = Number(draftQuotaCount);
    if (!Number.isFinite(value) || value < 1 || value > 1_000_000) {
      setQuotaError(t("流量额度必须在 1 到 1,000,000 GB 之间", "Traffic quota must be between 1 and 1,000,000 GB"));
      return;
    }
    if (!Number.isInteger(periodCount) || periodCount < 1 || periodCount > 365 || !/^\d{4}-\d{2}-\d{2}$/.test(draftQuotaAnchor)) {
      setQuotaError(t("请检查重置周期数量和重置日期", "Check the reset interval and reset date"));
      return;
    }
    const bytes = Math.round(value * 1_000_000_000);
    setQuotaError("");
    setQuotaSaving(true);
    try {
      await updateTrafficLimit({
        bytes,
        autoReset: draftQuotaAutoReset,
        periodUnit: draftQuotaUnit,
        periodCount,
        resetAnchor: draftQuotaAnchor,
        timezone: draftQuotaTimezone,
      });
      setDashboard((current) => ({
        ...current,
        overview: { ...current.overview, trafficLimitBytes: bytes },
        accounts: current.accounts.map((account) => ({
          ...account,
          quotaBytes: bytes,
        })),
      }));
      setQuotaOpen(false);
      showToast(t("总流量额度已保存", "Traffic quota saved"));
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError && error.code !== "request_failed"
        ? t(`保存失败：${error.code}`, `Save failed: ${error.code}`)
        : t("保存失败，请检查后端连接", "Save failed. Check the backend connection.");
      setQuotaError(message);
      showToast(message);
    } finally {
      setQuotaSaving(false);
    }
  }, [draftLimit, draftQuotaAnchor, draftQuotaAutoReset, draftQuotaCount, draftQuotaTimezone, draftQuotaUnit, loadDashboard, showToast, t]);
  const saveIntegration = useCallback(
    async (id: IntegrationId, values: Record<string, string>) => {
      try {
        await configureIntegration(id, true, values);
        await loadDashboard();
        showToast(
          t(
            "配置已保存并完成后端验证",
            "Configuration saved and verified by the backend",
          ),
        );
      } catch (error) {
        showToast(
          t(
            "验证失败，配置未保存。请检查回环地址、服务器 Secret 和日志。",
            "Validation failed and nothing was saved. Check the loopback endpoint, server secret, and logs.",
          ),
        );
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
            onViewServices={() => navigate("services")}
          />
        );
    }
  })();

  return (
    <div className="app-shell">
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
              <button className={`snapshot-time ${backendOnline ? "" : "is-stale"}`} onClick={() => setDateOpen((open) => !open)} aria-expanded={dateOpen} aria-label={t("显示快照日期", "Show snapshot date")}>
                <time dateTime={dashboard.generatedAt}>{dashboard.mode === "stale" ? t("停止更新", "Stale") : ""}{" "}{new Date(dashboard.generatedAt).toLocaleTimeString(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" })}</time>
              </button>
              <div className={`snapshot-date floating-surface ${dateOpen ? "is-open" : ""}`} role="status" aria-hidden={!dateOpen}>{new Date(dashboard.generatedAt).toLocaleDateString("en-CA").replaceAll("-", "")}</div>
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
      <nav
        className="bottom-navigation"
        aria-label={t("手机导航", "Mobile navigation")}
      >
        {visibleNavigation
          .filter((item) => item.id !== "setup")
          .slice(0, 4)
          .map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "is-active" : ""}
              onClick={() => navigate(item.id)}
            >
              <span>
                <Icon name={item.icon} filled={page === item.id} />
              </span>
              <small>{t(item.labelZh, item.labelEn)}</small>
            </button>
          ))}
        <button
          className={
            !visibleNavigation
              .filter((item) => item.id !== "setup")
              .slice(0, 4)
              .some((item) => item.id === page)
              ? "is-active"
              : ""
          }
          onClick={() => setDrawerOpen(true)}
        >
          <span>
            <Icon name="apps" />
          </span>
          <small>{t("更多", "More")}</small>
        </button>
      </nav>
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
          onEditQuota={() => {
            setSettingsOpen(false);
            openQuota();
          }}
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
      <Dialog
        open={quotaOpen}
        onClose={() => { if (!quotaSaving) setQuotaOpen(false); }}
        title={t("设置总流量额度", "Set total traffic quota")}
        size="small"
        actions={
          <>
            <Button
              variant="text"
              onClick={() => setQuotaOpen(false)}
              disabled={quotaSaving}
            >
              {t("取消", "Cancel")}
            </Button>
            <Button onClick={() => void saveQuota()} disabled={quotaSaving}>
              {quotaSaving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </Button>
          </>
        }
      >
        <label className="field">
          <span>{t("总流量（GB）", "Total traffic (GB)")}</span>
          <div className="quota-input-stable">
            <input
              type="number"
              min="1"
              max="1000000"
              step="1"
              inputMode="numeric"
              value={draftLimit}
              onChange={(event) => setDraftLimit(event.target.value)}
              autoComplete="off"
            />
            <span>GB</span>
          </div>
        </label>
        <div className="settings-row settings-row--switch quota-reset-switch">
          <span><Icon name="restart_alt" /><span><strong>{t("自动重置流量", "Automatic traffic reset")}</strong><small>{draftQuotaAutoReset ? t("到达所选周期边界时从 0 开始新周期", "Start a new cycle at the selected boundary") : t("持续累计用量，不会自动归零", "Keep accumulating usage without automatic reset")}</small></span></span>
          <SettingsSwitch checked={draftQuotaAutoReset} label={t("自动重置流量", "Automatic traffic reset")} onChange={() => setDraftQuotaAutoReset((current) => !current)} />
        </div>
        {draftQuotaAutoReset ? <div className="quota-schedule-grid">
          <label className="field"><span>{t("每隔", "Every")}</span><input type="number" min="1" max="365" step="1" inputMode="numeric" value={draftQuotaCount} onChange={(event) => setDraftQuotaCount(event.target.value)} /></label>
          <label className="field"><span>{t("计费单位", "Billing unit")}</span><select value={draftQuotaUnit} onChange={(event) => setDraftQuotaUnit(event.target.value as typeof draftQuotaUnit)}><option value="day">{t("日", "day(s)")}</option><option value="week">{t("周", "week(s)")}</option><option value="month">{t("月", "month(s)")}</option><option value="year">{t("年", "year(s)")}</option></select></label>
          <label className="field"><span>{t("重置基准日期", "Reset anchor date")}</span><input type="date" value={draftQuotaAnchor} onChange={(event) => setDraftQuotaAnchor(event.target.value)} /></label>
          <label className="field"><span>{t("时区设定", "Timezone")}</span><input value={draftQuotaTimezone} maxLength={64} placeholder="UTC" onChange={(event) => setDraftQuotaTimezone(event.target.value)} /></label>
          <p className="field-hint quota-schedule-summary">{t(`每 ${draftQuotaCount || "?"} ${draftQuotaUnit === "day" ? "日" : draftQuotaUnit === "week" ? "周" : draftQuotaUnit === "month" ? "月" : "年"}重置；基准日 ${draftQuotaAnchor || "—"}，时区 ${draftQuotaTimezone || "UTC"}`, `Reset every ${draftQuotaCount || "?"} ${draftQuotaUnit}(s), anchored on ${draftQuotaAnchor || "—"} in ${draftQuotaTimezone || "UTC"}`)}</p>
        </div> : null}
        {quotaError ? <div className="dialog-error" role="alert"><Icon name="error" size={19} /><span>{quotaError}</span></div> : null}
      </Dialog>
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

function SettingsDialog({
  open,
  onClose,
  mode,
  color,
  onMode,
  onColor,
  uiSettings,
  onUiSettings,
  nodeName,
  trafficLimitBytes,
  onEditQuota,
  onSaveNodeName,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  mode: ThemeMode;
  color: ThemeColor;
  onMode: (mode: ThemeMode) => void;
  onColor: (color: ThemeColor) => void;
  uiSettings: UiSettings;
  onUiSettings: (settings: Partial<UiSettings>) => Promise<void>;
  nodeName: string;
  trafficLimitBytes: number;
  onEditQuota: () => void;
  onSaveNodeName: (name: string) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { preference, setPreference, t } = useI18n();
  const [draftNodeName, setDraftNodeName] = useState(nodeName);
  const [draftPanelTitle, setDraftPanelTitle] = useState(uiSettings.panelTitle);
  const [saving, setSaving] = useState(false);
  const [uiSaving, setUiSaving] = useState(false);
  const [draftUiSettings, setDraftUiSettings] = useState(uiSettings);
  const [backgroundType, setBackgroundType] = useState<
    "default" | "url" | "server"
  >("default");
  const [backgroundValue, setBackgroundValue] = useState("");
  const [backgroundFiles, setBackgroundFiles] = useState<string[]>([]);
  const [backgroundDirectory, setBackgroundDirectory] = useState("");
  const [backgroundFit, setBackgroundFit] = useState<"cover" | "contain">("cover");
  const [backgroundPosition, setBackgroundPosition] = useState<"center" | "top" | "bottom" | "left" | "right">("center");
  useEffect(() => {
    if (!open) return;
    void fetchBackgroundOptions()
      .then((result) => {
        setBackgroundFiles(result.files);
        setBackgroundDirectory(result.directory);
        setBackgroundType(result.configured.type);
        setBackgroundValue(result.configured.value);
        setBackgroundFit(result.configured.fit ?? "cover");
        setBackgroundPosition(result.configured.position ?? "center");
      })
      .catch(() => undefined);
  }, [open]);
  const saveUiSettings = async (next: Partial<UiSettings>) => {
    if (uiSaving) return;
    const previous = draftUiSettings;
    setDraftUiSettings((current) => ({ ...current, ...next }));
    setUiSaving(true);
    try {
      await onUiSettings(next);
    } catch {
      setDraftUiSettings(previous);
    } finally {
      setUiSaving(false);
    }
  };
  const colors: Array<{
    id: ThemeColor;
    zh: string;
    en: string;
    value: string;
  }> = [
    { id: "violet", zh: "鸢尾紫", en: "Iris", value: "#7357a3" },
    { id: "blue", zh: "海湾蓝", en: "Bay", value: "#38618c" },
    { id: "green", zh: "青苔绿", en: "Moss", value: "#42664f" },
    { id: "rose", zh: "蔷薇红", en: "Rose", value: "#88525f" },
    { id: "amber", zh: "琥珀金", en: "Amber", value: "#7b5f21" },
    { id: "teal", zh: "深海青", en: "Teal", value: "#006a6a" },
    { id: "cyan", zh: "冰川青", en: "Cyan", value: "#00677c" },
    { id: "indigo", zh: "群青蓝", en: "Indigo", value: "#4b5f9e" },
    { id: "coral", zh: "珊瑚橙", en: "Coral", value: "#9b442a" },
    { id: "slate", zh: "岩灰蓝", en: "Slate", value: "#52606f" },
  ];
  if (!open) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("设置", "Settings")}
      actions={<Button onClick={onClose}>{t("完成", "Done")}</Button>}
    >
      <div className="theme-section">
        <h3>{t("常规", "General")}</h3>
        <label className="field">
          <span>{t("语言", "Language")}</span>
          <select
            value={preference}
            onChange={(event) =>
              setPreference(event.target.value as LanguagePreference)
            }
          >
            <option value="system">{t("跟随系统", "Follow system")}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">
          <span>{t("节点显示名称", "Node display name")}</span>
          <div className="settings-inline-field">
            <input
              value={draftNodeName}
              maxLength={80}
              onChange={(event) => setDraftNodeName(event.target.value)}
            />
            <Button
              compact
              disabled={
                saving ||
                !draftNodeName.trim() ||
                draftNodeName.trim() === nodeName
              }
              onClick={() => {
                setSaving(true);
                void onSaveNodeName(draftNodeName.trim()).finally(() =>
                  setSaving(false),
                );
              }}
            >
              {saving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </Button>
          </div>
        </label>
        <label className="field">
          <span>{t("面板标题", "Panel title")}</span>
          <div className="settings-inline-field">
            <input
              value={draftPanelTitle}
              maxLength={40}
              onChange={(event) => setDraftPanelTitle(event.target.value)}
            />
            <Button
              compact
              disabled={
                saving ||
                !draftPanelTitle.trim() ||
                draftPanelTitle.trim() === uiSettings.panelTitle
              }
              onClick={() => {
                setSaving(true);
                void onUiSettings({ panelTitle: draftPanelTitle.trim() }).finally(() =>
                  setSaving(false),
                );
              }}
            >
              {saving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </Button>
          </div>
          <small className="field-hint">
            {t("显示在左上角品牌位置。", "Shown in the upper-left brand area.")}
          </small>
        </label>
        <label className="field">
          <span>{t("在线超时时长", "Inactivity timeout")}</span>
          <select
            value={draftUiSettings.idleTimeoutMinutes}
            onChange={(event) =>
              void saveUiSettings({
                idleTimeoutMinutes: Number(event.target.value) as UiSettings["idleTimeoutMinutes"],
              })
            }
          >
            {[2, 5, 10, 15, 20, 30].map((minutes) => (
              <option key={minutes} value={minutes}>
                {t(`${minutes} 分钟`, `${minutes} minutes`)}
              </option>
            ))}
          </select>
          <small className="field-hint">
            {t("前后端都会执行该空闲时限；会话不能设置为永久有效。", "Both client and server enforce this inactivity limit; sessions cannot be made permanent.")}
          </small>
        </label>
      </div>
      <div className="settings-row settings-row--action">
        <span><Icon name="data_usage" /><span><strong>{t("总流量额度", "Total traffic quota")}</strong><small>{formatDecimalBytes(trafficLimitBytes)}</small></span></span>
        <Button variant="tonal" compact icon="edit" onClick={onEditQuota}>{t("设置", "Set")}</Button>
      </div>
      <div className="settings-row settings-row--switch">
        <span>
          <Icon name="checklist" />
          <span>
            <strong>{t("显示初始化向导页面", "Show Setup page")}</strong>
          </span>
        </span>
        <SettingsSwitch
          checked={draftUiSettings.showSetup}
          label={t("显示初始化向导页面", "Show Setup page")}
          disabled={uiSaving}
          onChange={() => void saveUiSettings({ showSetup: !draftUiSettings.showSetup })}
        />
      </div>
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="wallpaper" />
            <span>
              <strong>{t("登录背景", "Sign-in background")}</strong>
              <small>
                {t(
                  "选择默认背景、服务器目录图片或公网 HTTPS 图库 API。",
                  "Choose the default, a server-directory image, or a public HTTPS image API.",
                )}
              </small>
            </span>
          </span>
          <Icon name="expand_more" />
        </summary>
        <div className="background-settings">
          <label className="field">
            <span>{t("来源", "Source")}</span>
            <select
              value={backgroundType}
              onChange={(event) => {
                const next = event.target.value as typeof backgroundType;
                setBackgroundType(next);
                setBackgroundValue(
                  next === "server" ? (backgroundFiles[0] ?? "") : "",
                );
              }}
            >
              <option value="default">
                {t("默认 Material 背景", "Default Material background")}
              </option>
              <option value="server">{t("服务器图片", "Server image")}</option>
              <option value="url">{t("图库 API", "Image API")}</option>
            </select>
          </label>
          {backgroundType === "server" ? (
            <label className="field">
              <span>{t("允许图片", "Allowed image")}</span>
              <select
                value={backgroundValue}
                onChange={(event) => setBackgroundValue(event.target.value)}
                disabled={!backgroundFiles.length}
              >
                <option value="">
                  {backgroundFiles.length
                    ? t("请选择", "Select")
                    : t("目录中没有可用图片", "No allowed images found")}
                </option>
                {backgroundFiles.map((file) => (
                  <option key={file} value={file}>
                    {file}
                  </option>
                ))}
              </select>
              <small className="field-hint">{t(`图片目录：${backgroundDirectory || "读取中…"}（仅读取该目录顶层的 PNG、JPEG、WebP）`, `Image directory: ${backgroundDirectory || "Loading…"} (top-level PNG, JPEG, and WebP files only)`)}</small>
            </label>
          ) : null}
          {backgroundType === "url" ? (
            <label className="field">
              <span>{t("图库 API 地址", "Image API URL")}</span>
              <input
                type="url"
                placeholder="https://images.example.com/api/random?size=large"
                value={backgroundValue}
                onChange={(event) => setBackgroundValue(event.target.value)}
              />
              <small className="field-hint">
                {t(
                  "支持直接图片、HTTP 重定向，以及返回 url、image、imageUrl 或 image_url 字段的 JSON；后端只允许公网 HTTPS，限制 5 MB 并缓存 15 分钟。",
                  "Supports direct images, HTTP redirects, and JSON containing url, image, imageUrl, or image_url. The backend accepts public HTTPS only, limits images to 5 MB, and caches for 15 minutes.",
                )}
              </small>
            </label>
          ) : null}
          {backgroundType !== "default" ? <div className="form-grid background-layout-controls"><label className="field"><span>{t("缩放方式", "Image fit")}</span><select value={backgroundFit} onChange={(event) => setBackgroundFit(event.target.value as typeof backgroundFit)}><option value="cover">{t("填满并裁切", "Cover and crop")}</option><option value="contain">{t("完整显示", "Contain")}</option></select></label><label className="field"><span>{t("图片位置", "Image position")}</span><select value={backgroundPosition} onChange={(event) => setBackgroundPosition(event.target.value as typeof backgroundPosition)}><option value="center">{t("居中", "Center")}</option><option value="top">{t("顶部", "Top")}</option><option value="bottom">{t("底部", "Bottom")}</option><option value="left">{t("左侧", "Left")}</option><option value="right">{t("右侧", "Right")}</option></select></label></div> : null}
          <Button
            variant="tonal"
            disabled={
              saving || (backgroundType !== "default" && !backgroundValue)
            }
            onClick={() => {
              setSaving(true);
              void updateLoginBackground(backgroundType, backgroundValue, backgroundFit, backgroundPosition)
                .then(() => onToast(t("登录背景已保存", "Sign-in background saved")))
                .catch(() => onToast(t("登录背景保存失败，请检查图片地址或服务器目录", "Unable to save the sign-in background. Check the image URL or server directory.")))
                .finally(() => setSaving(false));
            }}
          >
            {t("保存登录背景", "Save sign-in background")}
          </Button>
        </div>
      </details>
      <section className="theme-section theme-style-group">
        <h3>{t("主题风格", "Theme style")}</h3>
        <div className="theme-style-item">
          <div className="theme-style-heading">
            <Icon name="contrast" />
            <div>
              <strong>{t("显示模式", "Display mode")}</strong>
              <small>{t("选择浅色、深色或跟随系统。", "Choose light, dark, or system appearance.")}</small>
            </div>
          </div>
          <div className="theme-mode-grid">
            {THEME_MODES.map((item) => (
              <button
                key={item}
                className={mode === item ? "is-selected" : ""}
                onClick={() => onMode(item)}
              >
                <span className={`theme-preview theme-preview--${item}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <Icon name={item === "light" ? "light_mode" : item === "dark" ? "dark_mode" : "desktop_windows"} size={19} />
                  {item === "light" ? t("浅色", "Light") : item === "dark" ? t("深色", "Dark") : t("跟随系统", "System")}
                </div>
              </button>
            ))}
          </div>
        </div>
        <details className="settings-disclosure theme-style-item">
          <summary>
            <span>
              <Icon name="palette" />
              <span>
                <strong>{t("主题色彩", "Theme color")}</strong>
                <small>{t("选择面板的 Material 配色。", "Choose the panel's Material color palette.")}</small>
              </span>
            </span>
            <span className="disclosure-status"><i className="selected-color-dot" style={{ background: colors.find((item) => item.id === color)?.value }} /><Icon name="expand_more" /></span>
          </summary>
          <div className="color-options disclosure-content">
            {colors.map((item) => (
              <button key={item.id} className={color === item.id ? "is-selected" : ""} onClick={() => onColor(item.id)}>
                <span style={{ background: item.value }}>{color === item.id ? <Icon name="check" size={18} /> : null}</span>
                <small>{t(item.zh, item.en)}</small>
              </button>
            ))}
          </div>
        </details>
        <details className="settings-disclosure theme-style-item">
          <summary>
            <span>
              <Icon name="dashboard_customize" />
              <span>
                <strong>{t("面板自定义", "Panel customization")}</strong>
                <small>{t("选择在导航中显示的功能面板。", "Choose the feature panels shown in navigation.")}</small>
              </span>
            </span>
            <span className="disclosure-status"><small>{t(`已显示 ${draftUiSettings.visiblePanels.length} 项`, `${draftUiSettings.visiblePanels.length} shown`)}</small><Icon name="expand_more" /></span>
          </summary>
          <div className="panel-toggle-list disclosure-content">
            {PANEL_IDS.map((id) => {
              const item = navigation.find((candidate) => candidate.id === id)!;
              const checked = draftUiSettings.visiblePanels.includes(id);
              return (
                <div className="panel-toggle-item" key={id}>
                  <span><Icon name={item.icon} />{t(item.labelZh, item.labelEn)}</span>
                  <SettingsSwitch
                    checked={checked}
                    label={t(`${item.labelZh}显示状态`, `Show ${item.labelEn}`)}
                    disabled={uiSaving}
                    onChange={() => void saveUiSettings({ visiblePanels: checked ? draftUiSettings.visiblePanels.filter((panel) => panel !== id) : [...draftUiSettings.visiblePanels, id] })}
                  />
                </div>
              );
            })}
          </div>
        </details>
      </section>
    </Dialog>
  );
}

export function SettingsSwitch({ checked, label, disabled = false, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={`md-switch settings-switch-control ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span aria-hidden="true" />
    </button>
  );
}
