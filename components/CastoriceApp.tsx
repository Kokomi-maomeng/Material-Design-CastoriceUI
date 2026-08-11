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
  const toastSequence = useRef(0);

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
    if (!session) return;
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
  };
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
    setDraftLimit(
      String(
        Math.max(
          1,
          Math.round(dashboard.overview.trafficLimitBytes / 1024 ** 3),
        ),
      ),
    );
    setQuotaOpen(true);
  }, [dashboard.overview.trafficLimitBytes]);
  const saveQuota = useCallback(async () => {
    const value = Number(draftLimit);
    if (!Number.isFinite(value) || value <= 0) {
      showToast(
        t(
          "请输入大于 0 的有效流量额度",
          "Enter a valid traffic quota above zero",
        ),
      );
      return;
    }
    const bytes = Math.round(value * 1024 ** 3);
    setQuotaSaving(true);
    try {
      await updateTrafficLimit(bytes);
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
    } catch {
      showToast(
        t(
          "保存失败，请检查后端连接",
          "Save failed. Check the backend connection.",
        ),
      );
    } finally {
      setQuotaSaving(false);
    }
  }, [draftLimit, loadDashboard, showToast, t]);
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
          key={selectedSetup ?? "closed"}
          selected={selectedSetup}
          status={selectedSetup ? integrationFor(selectedSetup) : undefined}
          preview={false}
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
        <Toast key={toast?.id ?? "closed"} message={toast?.message ?? null} onDismiss={dismissToast} />
      </>
    );

  const content = (() => {
    switch (page) {
      case "setup":
        return (
          <SetupPage
            statuses={dashboard.integrations}
            preview={false}
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
            onToast={showToast}
            traffic={dashboard.traffic}
            integration={integrationFor("traffic")}
            onConfigure={() => configurePage("traffic")}
          />
        );
      case "subscriptions":
        return (
          <SubscriptionsPage
            subscriptions={dashboard.subscriptions}
            integration={integrationFor("subscriptions")}
            onConfigure={() => configurePage("subscriptions")}
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
            integration={integrationFor("system")}
            onConfigure={() => configurePage("system")}
          />
        );
      case "alerts":
        return (
          <AlertsPage
            alerts={alerts}
            integration={integrationFor("alerts")}
            onConfigure={() => configurePage("alerts")}
            onAcknowledge={(id) => {
              setAlerts((current) =>
                current.map((item) =>
                  item.id === id ? { ...item, acknowledged: true } : item,
                ),
              );
              void acknowledgeAlert(id).catch(() => undefined);
              showToast(t("告警已确认", "Alert acknowledged"));
            }}
            onToast={showToast}
          />
        );
      case "audit":
        return (
          <AuditPage
            events={dashboard.auditEvents}
            integration={integrationFor("audit")}
            onConfigure={() => configurePage("audit")}
          />
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
            <strong>CastoriceUI</strong>
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
            <div className="snapshot-time-wrap">
              <button className={`snapshot-time ${backendOnline ? "" : "is-stale"}`} onClick={() => setDateOpen((open) => !open)} aria-expanded={dateOpen} aria-label={t("显示快照日期", "Show snapshot date")}>
                <time dateTime={dashboard.generatedAt}>{dashboard.mode === "stale" ? t("停止更新", "Stale") : ""}{" "}{new Date(dashboard.generatedAt).toLocaleTimeString(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" })}</time>
              </button>
              {dateOpen ? <div className="snapshot-date" role="status">{new Date(dashboard.generatedAt).toLocaleDateString("en-CA").replaceAll("-", "")}</div> : null}
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
            <div className="user-menu-wrap">
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
              {userMenuOpen ? (
                <div className="user-popover" role="menu">
                  <button role="menuitem" onClick={() => void signOut()}>
                    <Icon name="logout" size={19} />
                    {t("注销", "Sign out")}
                  </button>
                </div>
              ) : null}
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
    <SettingsDialog
      key={`${settingsOpen}-${dashboard.overview.nodeName}`}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode={themeMode}
        color={themeColor}
        onMode={setThemeMode}
        onColor={setThemeColor}
        uiSettings={uiSettings}
        onUiSettings={async (next) => {
          const saved = await updateUiSettings(next);
          setDashboard((current) => ({ ...current, uiSettings: saved }));
        }}
        nodeName={dashboard.overview.nodeName}
        onSaveNodeName={async (nodeName) => {
          await saveIntegration("system", { nodeName });
        }}
      />
      <SetupWizard
        key={selectedSetup ?? "closed"}
        selected={selectedSetup}
        status={selectedSetup ? integrationFor(selectedSetup) : undefined}
        preview={false}
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
        onClose={() => setQuotaOpen(false)}
        title={t("设置总流量额度", "Set total traffic quota")}
        description={t(
          "总览与账号管理会立即使用同一个额度。",
          "Overview and account management use the same quota immediately.",
        )}
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
        <p className="field-hint">
          {t(
            "输入期间的实时刷新不会移动单位或覆盖当前值。",
            "Live refreshes do not move the unit or overwrite the value while editing.",
          )}
        </p>
      </Dialog>
      <Toast key={toast?.id ?? "closed"} message={toast?.message ?? null} onDismiss={dismissToast} />
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
  onSaveNodeName,
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
  onSaveNodeName: (name: string) => Promise<void>;
}) {
  const { preference, setPreference, t } = useI18n();
  const [draftNodeName, setDraftNodeName] = useState(nodeName);
  const [saving, setSaving] = useState(false);
  const [backgroundType, setBackgroundType] = useState<
    "default" | "url" | "server"
  >("default");
  const [backgroundValue, setBackgroundValue] = useState("");
  const [backgroundFiles, setBackgroundFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    void fetchBackgroundOptions()
      .then((result) => {
        setBackgroundFiles(result.files);
        setBackgroundType(result.configured.type);
        setBackgroundValue(result.configured.value);
      })
      .catch(() => undefined);
  }, [open]);
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
      description={t(
        "管理语言、节点、导航、登录背景和外观。",
        "Manage language, node, navigation, sign-in background, and appearance.",
      )}
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
          <small className="field-hint">
            {t(
              "系统语言不是中文或 English 时默认使用 English。",
              "English is used when the system language is neither Chinese nor English.",
            )}
          </small>
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
      </div>
      <button
        className="settings-row settings-row--button"
        role="switch"
        aria-checked={uiSettings.showSetup}
        onClick={() => void onUiSettings({ showSetup: !uiSettings.showSetup })}
      >
        <span>
          <Icon name="checklist" />
          <span>
            <strong>{t("显示初始化向导页面", "Show Setup page")}</strong>
            <small>
              {t(
                "控制左侧导航中的独立初始化向导入口。",
                "Controls the standalone Setup entry in navigation.",
              )}
            </small>
          </span>
        </span>
        <span className="settings-switch-control" aria-hidden="true">
          <small>{uiSettings.showSetup ? t("开启", "On") : t("关闭", "Off")}</small>
          <span className={`md-switch ${uiSettings.showSetup ? "is-on" : ""}`}><span /></span>
        </span>
      </button>
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="dashboard_customize" />
            <span>
              <strong>{t("面板自定义", "Panel customization")}</strong>
              <small>
                {t(
                  "总览和初始化向导不在隐藏范围内。",
                  "Overview and Setup cannot be hidden here.",
                )}
              </small>
            </span>
          </span>
          <span className="disclosure-status"><small>{t(`已显示 ${uiSettings.visiblePanels.length} 项`, `${uiSettings.visiblePanels.length} shown`)}</small><Icon name="expand_more" /></span>
        </summary>
        <div className="panel-toggle-list">
          {PANEL_IDS.map((id) => {
            const item = navigation.find((candidate) => candidate.id === id)!;
            const checked = uiSettings.visiblePanels.includes(id);
            return (
              <button
                key={id}
                role="switch"
                aria-checked={checked}
                onClick={() =>
                  void onUiSettings({
                    visiblePanels: checked
                      ? uiSettings.visiblePanels.filter((panel) => panel !== id)
                      : [...uiSettings.visiblePanels, id],
                  })
                }
              >
                <span>
                  <Icon name={item.icon} />
                  {t(item.labelZh, item.labelEn)}
                </span>
                <span className="settings-switch-control" aria-hidden="true">
                  <small>{checked ? t("显示", "Shown") : t("隐藏", "Hidden")}</small>
                  <span className={`md-switch ${checked ? "is-on" : ""}`}><span /></span>
                </span>
              </button>
            );
          })}
        </div>
      </details>
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="wallpaper" />
            <span>
              <strong>{t("登录背景", "Sign-in background")}</strong>
              <small>
                {t(
                  "选择默认背景、服务器允许图片或 HTTPS 链接。",
                  "Choose the default, an allowed server image, or an HTTPS URL.",
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
              <option value="url">HTTPS URL</option>
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
            </label>
          ) : null}
          {backgroundType === "url" ? (
            <label className="field">
              <span>HTTPS URL</span>
              <input
                type="url"
                placeholder="https://images.example.com/background.webp"
                value={backgroundValue}
                onChange={(event) => setBackgroundValue(event.target.value)}
              />
              <small className="field-hint">
                {t(
                  "图片由浏览器直接加载；面板后端不会代抓取外链。",
                  "The browser loads the image directly; the backend never fetches remote URLs.",
                )}
              </small>
            </label>
          ) : null}
          <Button
            variant="tonal"
            disabled={
              saving || (backgroundType !== "default" && !backgroundValue)
            }
            onClick={() => {
              setSaving(true);
              void updateLoginBackground(
                backgroundType,
                backgroundValue,
              ).finally(() => setSaving(false));
            }}
          >
            {t("保存登录背景", "Save sign-in background")}
          </Button>
        </div>
      </details>
      <div className="theme-section">
        <h3>{t("显示模式", "Display mode")}</h3>
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
                <Icon
                  name={
                    item === "light"
                      ? "light_mode"
                      : item === "dark"
                        ? "dark_mode"
                        : "desktop_windows"
                  }
                  size={19}
                />
                {item === "light"
                  ? t("浅色", "Light")
                  : item === "dark"
                    ? t("深色", "Dark")
                    : t("跟随系统", "System")}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="theme-section">
        <h3>{t("主题色彩", "Theme color")}</h3>
        <div className="color-options">
          {colors.map((item) => (
            <button
              key={item.id}
              className={color === item.id ? "is-selected" : ""}
              onClick={() => onColor(item.id)}
            >
              <span style={{ background: item.value }}>
                {color === item.id ? <Icon name="check" size={18} /> : null}
              </span>
              <small>{t(item.zh, item.en)}</small>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
