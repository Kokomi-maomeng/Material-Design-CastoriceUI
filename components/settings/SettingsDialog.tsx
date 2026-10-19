import { useEffect, useRef, useState } from "react";
import { ApiError, changePassword, fetchBackgroundOptions, updateLoginBackground } from "../../lib/api";
import { formatDecimalBytes, formatTimeSpan } from "../../lib/format";
import { BACKGROUND_TIMES, GLASS_PRESETS } from "../../lib/login-background";
import { useI18n, type LanguagePreference } from "../../lib/i18n";
import { navigation, PANEL_IDS } from "../../lib/navigation";
import { PROJECT_AUTHOR, PROJECT_NAME, PROJECT_URL, PROJECT_VERSION } from "../../lib/project";
import { THEME_MODES, type ThemeColor, type ThemeMode } from "../../lib/theme";
import type { LoginAppearance, UiSettings } from "../../lib/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { Collapse } from "../ui/Collapse";
import { AnimatedDetails } from "../ui/AnimatedDetails";
import { PresetSlider } from "../ui/PresetSlider";
export function SettingsDialog({
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
  onAppearance,
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
  onAppearance?: (appearance: LoginAppearance) => void;
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
  const [backgroundValues, setBackgroundValues] = useState({ url: "", server: "" });
  const [backgroundReady, setBackgroundReady] = useState(false);
  const backgroundValue = backgroundType === "default" ? "" : backgroundValues[backgroundType];
  const setBackgroundValue = (value: string) => {
    if (backgroundType !== "default") setBackgroundValues((current) => ({ ...current, [backgroundType]: value }));
  };
  const [backgroundFiles, setBackgroundFiles] = useState<string[]>([]);
  const [backgroundDirectory, setBackgroundDirectory] = useState("");
  const [backgroundFit, setBackgroundFit] = useState<"cover" | "contain">("cover");
  const [backgroundSeconds, setBackgroundSeconds] = useState<NonNullable<LoginAppearance["cacheSeconds"]>>(0);
  const [glass, setGlass] = useState<NonNullable<LoginAppearance["glass"]>>("default");
  const [glassFlags, setGlassFlags] = useState({ url: false, server: false });
  const glassEnabled = backgroundType !== "default" && glassFlags[backgroundType];
  const setGlassEnabled = (enabled: boolean) => {
    if (backgroundType !== "default") setGlassFlags((current) => ({ ...current, [backgroundType]: enabled }));
  };
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraftNodeName(nodeName);
      setDraftPanelTitle(uiSettings.panelTitle);
      setDraftUiSettings(uiSettings);
    }
    wasOpen.current = open;
  }, [nodeName, open, uiSettings]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetchBackgroundOptions()
      .then((result) => {
        if (!active) return;
        setBackgroundFiles(result.files);
        setBackgroundDirectory(result.directory);
        setBackgroundType(result.configured.type);
        setBackgroundValues({ url: result.configured.type === "url" ? result.configured.value : "", server: result.configured.type === "server" ? result.configured.value : result.files[0] ?? "" });
        setBackgroundFit(result.configured.fit ?? "cover");
        setBackgroundSeconds(result.configured.cacheSeconds ?? 0);
        setGlass(result.configured.glass ?? "default");
        setGlassFlags({ url: result.configured.type === "url" && result.configured.glassEnabled === true, server: result.configured.type === "server" && result.configured.glassEnabled === true });
        setBackgroundReady(true);
        onAppearance?.(result.selected);
      })
      .catch(() => undefined);
    return () => { active = false; setBackgroundReady(false); };
  }, [open, onAppearance]);
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
  const closeSettings = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    onClose();
  };
  const savePassword = async () => {
    if (passwordSaving) return;
    setPasswordError("");
    const passwordClasses = [/[a-z]/.test(newPassword), /[A-Z]/.test(newPassword), /\d/.test(newPassword), /[^A-Za-z0-9]/.test(newPassword)].filter(Boolean).length;
    if (!currentPassword) {
      setPasswordError(t("请输入旧密码。", "Enter the current password."));
      return;
    }
    if (newPassword.length < 12 || passwordClasses < 3) {
      setPasswordError(t("新密码至少 12 位，并包含大小写字母、数字、符号中的三类。", "Use at least 12 characters and three of uppercase, lowercase, numbers, and symbols."));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("两次输入的新密码不一致。", "The new passwords do not match."));
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError(t("新密码不能与旧密码相同。", "The new password must differ from the current password."));
      return;
    }
    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onToast(t("密码已更改，其他登录会话已失效", "Password changed; other sessions were signed out"));
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "request_failed";
      setPasswordError(code === "invalid_current_password"
        ? t("旧密码不正确。", "The current password is incorrect.")
        : t("密码更改失败，请检查密码规则或后端连接。", "Unable to change the password. Check the password rules or backend connection."));
    } finally {
      setPasswordSaving(false);
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
  return (
    <Dialog className="settings-dialog"
      open={open}
      onClose={closeSettings}
      title={t("设置", "Settings")}
      actions={<Button onClick={closeSettings}>{t("完成", "Done")}</Button>}
    >
      <section className="theme-section general-settings-group">
        <h3><Icon name="tune" /><span>{t("常规", "General")}</span></h3>
        <AnimatedDetails className="settings-disclosure general-setting-item">
          <summary><span><Icon name="translate" /><span><strong>{t("语言", "Language")}</strong><small>{preference === "system" ? t("跟随系统", "Follow system") : preference === "zh" ? "中文" : "English"}</small></span></span><Icon name="expand_more" /></summary>
          <div className="disclosure-content general-setting-content">
            <div className="field"><span>{t("语言", "Language")}</span><MaterialSelect ariaLabel={t("语言", "Language")} value={preference} options={[{ value: "system", label: t("跟随系统", "Follow system") }, { value: "zh", label: "中文" }, { value: "en", label: "English" }]} onChange={(value) => setPreference(value as LanguagePreference)} /></div>
          </div>
        </AnimatedDetails>
        <AnimatedDetails className="settings-disclosure general-setting-item">
          <summary><span><Icon name="dns" /><span><strong>{t("节点显示名称", "Node display name")}</strong><small>{nodeName}</small></span></span><Icon name="expand_more" /></summary>
          <div className="disclosure-content general-setting-content">
            <label className="field"><span>{t("节点显示名称", "Node display name")}</span><div className="settings-inline-field"><input value={draftNodeName} maxLength={80} onChange={(event) => setDraftNodeName(event.target.value)} /><Button compact disabled={saving || !draftNodeName.trim() || draftNodeName.trim() === nodeName} onClick={() => { setSaving(true); void onSaveNodeName(draftNodeName.trim()).finally(() => setSaving(false)); }}>{saving ? t("保存中…", "Saving…") : t("保存", "Save")}</Button></div></label>
          </div>
        </AnimatedDetails>
        <AnimatedDetails className="settings-disclosure general-setting-item">
          <summary><span><Icon name="title" /><span><strong>{t("面板标题", "Panel title")}</strong><small>{uiSettings.panelTitle}</small></span></span><Icon name="expand_more" /></summary>
          <div className="disclosure-content general-setting-content">
            <label className="field"><span>{t("面板标题", "Panel title")}</span><div className="settings-inline-field"><input value={draftPanelTitle} maxLength={40} onChange={(event) => setDraftPanelTitle(event.target.value)} /><Button compact disabled={saving || !draftPanelTitle.trim() || draftPanelTitle.trim() === uiSettings.panelTitle} onClick={() => { setSaving(true); void onUiSettings({ panelTitle: draftPanelTitle.trim() }).finally(() => setSaving(false)); }}>{saving ? t("保存中…", "Saving…") : t("保存", "Save")}</Button></div></label>
          </div>
        </AnimatedDetails>
        <AnimatedDetails className="settings-disclosure general-setting-item">
          <summary><span><Icon name="timer" /><span><strong>{t("在线超时时长", "Inactivity timeout")}</strong><small>{`${draftUiSettings.idleTimeoutMinutes}min`}</small></span></span><Icon name="expand_more" /></summary>
          <div className="disclosure-content general-setting-content">
            <div className="field"><span>{t("在线超时时长", "Inactivity timeout")}</span><MaterialSelect ariaLabel={t("在线超时时长", "Inactivity timeout")} value={String(draftUiSettings.idleTimeoutMinutes)} options={[2, 5, 10, 15, 20, 30].map((minutes) => ({ value: String(minutes), label: `${minutes}min` }))} onChange={(value) => void saveUiSettings({ idleTimeoutMinutes: Number(value) as UiSettings["idleTimeoutMinutes"] })} /></div>
          </div>
        </AnimatedDetails>
      </section>
      <div className="settings-row settings-row--action">
        <span><Icon name="data_usage" /><span><strong>{t("总流量额度", "Total traffic quota")}</strong><small>{formatDecimalBytes(trafficLimitBytes)}</small></span></span>
        <Button variant="tonal" compact icon="edit" onClick={onEditQuota}>{t("设置", "Set")}</Button>
      </div>
      <AnimatedDetails className="settings-disclosure security-settings">
        <summary>
          <span><Icon name="password" /><span><strong>{t("更换密码", "Change password")}</strong></span></span>
          <Icon name="expand_more" />
        </summary>
        <div className="password-settings disclosure-content">
          <label className="field"><span>{t("旧密码", "Current password")}</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="field"><span>{t("新密码", "New password")}</span><input type="password" minLength={12} maxLength={512} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small className="field-hint">{t("至少 12 位，并包含大小写字母、数字、符号中的三类。", "Use at least 12 characters and three of uppercase, lowercase, numbers, and symbols.")}</small></label>
          <label className="field"><span>{t("确认新密码", "Confirm new password")}</span><input type="password" minLength={12} maxLength={512} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          {passwordError ? <div className="dialog-error" role="alert"><Icon name="error" size={19} /><span>{passwordError}</span></div> : null}
          <Button variant="tonal" icon="password" disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword} onClick={() => void savePassword()}>{passwordSaving ? t("更改中…", "Changing…") : t("更换密码", "Change password")}</Button>
        </div>
      </AnimatedDetails>
      <section className="theme-section theme-style-group">
        <h3><Icon name="palette" /><span>{t("主题风格", "Theme style")}</span></h3>
        <AnimatedDetails className="settings-disclosure theme-style-item">
          <summary>
            <span><Icon name="contrast" /><span><strong>{t("显示模式", "Display mode")}</strong><small>{mode === "light" ? t("浅色", "Light") : mode === "dark" ? t("深色", "Dark") : t("跟随系统", "System")}</small></span></span>
            <Icon name="expand_more" />
          </summary>
          <div className="theme-mode-grid disclosure-content">
            {THEME_MODES.map((item) => (
              <button key={item} className={mode === item ? "is-selected" : ""} onClick={() => onMode(item)}>
                <span className={`theme-preview theme-preview--${item}`}><i /><i /><i /></span>
                <div><Icon name={item === "light" ? "light_mode" : item === "dark" ? "dark_mode" : "desktop_windows"} size={19} />{item === "light" ? t("浅色", "Light") : item === "dark" ? t("深色", "Dark") : t("跟随系统", "System")}</div>
              </button>
            ))}
          </div>
        </AnimatedDetails>
        <AnimatedDetails className="settings-disclosure theme-style-item">
          <summary>
            <span><Icon name="palette" /><span><strong>{t("主题色彩", "Theme color")}</strong><small>{t("选择面板的 Material 配色", "Choose the panel's Material color palette")}</small></span></span>
            <span className="disclosure-status"><i className="selected-color-dot" style={{ background: colors.find((item) => item.id === color)?.value }} /><Icon name="expand_more" /></span>
          </summary>
          <div className="color-options disclosure-content">
            {colors.map((item) => <button key={item.id} className={color === item.id ? "is-selected" : ""} onClick={() => onColor(item.id)}><span style={{ background: item.value }}>{color === item.id ? <Icon name="check" size={18} /> : null}</span><small>{t(item.zh, item.en)}</small></button>)}
          </div>
        </AnimatedDetails>
      <AnimatedDetails className="settings-disclosure theme-style-item">
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
          <div className="field">
            <span>{t("来源", "Source")}</span>
            <MaterialSelect
              ariaLabel={t("登录背景来源", "Sign-in background source")}
              value={backgroundType}
              disabled={!backgroundReady}
              options={[{ value: "default", label: t("默认 Material 背景", "Default Material background") }, { value: "server", label: t("服务器图片", "Server image") }, { value: "url", label: t("图库 API", "Image API") }]}
              onChange={(value) => {
                const next = value as typeof backgroundType;
                setBackgroundType(next);
              }}
            />
          </div>
          <Collapse expanded={backgroundType === "server"}>
            <div className="field">
              <span>{t("允许图片", "Allowed image")}</span>
              <MaterialSelect
                ariaLabel={t("允许图片", "Allowed image")}
                value={backgroundValue}
                onChange={setBackgroundValue}
                disabled={!backgroundFiles.length}
                searchable={backgroundFiles.length > 8}
                placeholder={backgroundFiles.length ? t("请选择", "Select") : t("目录中没有可用图片", "No allowed images found")}
                options={backgroundFiles.map((file) => ({ value: file, label: file }))}
              />
              <small className="field-hint">{t(`图片目录：${backgroundDirectory || "读取中…"}（仅读取该目录顶层的 PNG、JPEG、WebP）`, `Image directory: ${backgroundDirectory || "Loading…"} (top-level PNG, JPEG, and WebP files only)`)}</small>
            </div>
          </Collapse>
          <Collapse expanded={backgroundType === "url"}>
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
                  "支持图片、重定向或图片链接 JSON，单张最大 30 MB。缓存到期后下次访问时更新；不缓存时每次访问请求新图，失败时回退到上一张。",
                  "Supports images, redirects, or image-link JSON, up to 30 MB per image. Screen sizes have separate caches. The next visit after expiry refreshes the image; failures retain the last image.",
                )}
              </small>
            </label>
          </Collapse>
          <Collapse expanded={backgroundType !== "default"}><div className="background-custom-controls"><div className="form-grid background-layout-controls">
            <div className="field"><span>{t("缩放方式", "Image fit")}</span><MaterialSelect ariaLabel={t("缩放方式", "Image fit")} value={backgroundFit} options={[{ value: "cover", label: t("填满并裁切", "Cover and crop") }, { value: "contain", label: t("完整显示", "Contain") }]} onChange={(value) => setBackgroundFit(value as typeof backgroundFit)} /></div>
            <div className="field"><span>{t("缓存时间", "Cache duration")}</span><MaterialSelect ariaLabel={t("缓存时间", "Cache duration")} value={String(backgroundSeconds)} options={BACKGROUND_TIMES.map((seconds) => ({ value: String(seconds), label: seconds ? formatTimeSpan(seconds) : t("不缓存", "No cache") }))} disabled={backgroundType === "server"} onChange={(value) => setBackgroundSeconds(Number(value) as typeof backgroundSeconds)} /></div>
          </div>
          <div className="glass-settings">
            <div className="settings-row settings-row--switch glass-toggle-row"><span><Icon name="water_drop" /><span><strong>{t("液态玻璃", "Liquid Glass")}</strong></span></span><SettingsSwitch checked={glassEnabled} label={t("液态玻璃", "Liquid Glass")} onChange={() => setGlassEnabled(!glassEnabled)} /></div>
            <Collapse expanded={glassEnabled}><div className="glass-slider">
              <PresetSlider value={GLASS_PRESETS.indexOf(glass)} labels={[t("透明", "Clear"), t("默认", "Default"), t("色调", "Tinted")]} ariaLabel={t("玻璃透明效果", "Glass transparency")} onChange={(index) => setGlass(GLASS_PRESETS[index])} />
            </div></Collapse>
          </div></div></Collapse>
          <Button
            variant="tonal"
            disabled={
              saving || !backgroundReady || (backgroundType !== "default" && !backgroundValue)
            }
            onClick={() => {
              setSaving(true);
              void updateLoginBackground({ type: backgroundType, value: backgroundValue, fit: backgroundFit, cacheSeconds: backgroundSeconds, glass, glassEnabled: backgroundType !== "default" && glassEnabled })
                .then((appearance) => { onAppearance?.(appearance); onToast(t("登录背景已保存", "Sign-in background saved")); })
                .catch(() => onToast(t("登录背景保存失败，请检查图片地址或服务器目录", "Unable to save the sign-in background. Check the image URL or server directory.")))
                .finally(() => setSaving(false));
            }}
          >
            {t("保存登录背景", "Save sign-in background")}
          </Button>
        </div>
      </AnimatedDetails>
      </section>
      <section className="theme-section page-customization-group">
        <h3><Icon name="dashboard_customize" /><span>{t("页面自定义", "Page customization")}</span></h3>
        <div className="settings-row settings-row--switch page-customization-switch">
          <span><Icon name="checklist" /><span><strong>{t("显示初始化向导页面", "Show Setup page")}</strong></span></span>
          <SettingsSwitch checked={draftUiSettings.showSetup} label={t("显示初始化向导页面", "Show Setup page")} disabled={uiSaving} onChange={() => void saveUiSettings({ showSetup: !draftUiSettings.showSetup })} />
        </div>
        <AnimatedDetails className="settings-disclosure theme-style-item">
          <summary>
            <span>
              <Icon name="dashboard_customize" />
              <span>
                <strong>{t("面板自定义", "Panel customization")}</strong>
                <small>{t("选择在导航中显示的功能面板", "Choose the feature panels shown in navigation")}</small>
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
        </AnimatedDetails>
      </section>
      <section className="theme-section settings-about-section">
        <h3 className="settings-about__heading"><Icon name="info" /><span>{t("关于详情", "About")}</span></h3>
        <div className="settings-about__content">
          <dl>
            <div><dt>{t("GitHub 作者", "GitHub author")}</dt><dd>{PROJECT_AUTHOR}</dd></div>
            <div><dt>{t("项目名称", "Project name")}</dt><dd>{PROJECT_NAME}</dd></div>
            <div><dt>{t("当前版本", "Current version")}</dt><dd>v{PROJECT_VERSION}</dd></div>
          </dl>
          <a href={PROJECT_URL} target="_blank" rel="noreferrer noopener"><Icon name="code" /><span>{t("项目 GitHub 主页", "Project GitHub homepage")}</span><Icon name="open_in_new" size={18} /></a>
        </div>
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
