import { useState, type FormEvent } from "react";
import type { BootstrapState, SessionState } from "../../lib/types";
import { initializeAdministrator, login } from "../../lib/api";
import { isLanguagePreference, languageSelect, useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { useLoginBackground } from "./useLoginBackground";
import { LiquidGlass } from "./LiquidGlass";
import { useGlassLight } from "./useGlassLight";

export function AuthPage({ bootstrap, onAuthenticated, background: documentBackground }: { bootstrap: BootstrapState; onAuthenticated: (session: SessionState) => void; background?: string }) {
  const { language, preference, setPreference, t } = useI18n();
  const { label: languageLabel, options: languageOptions } = languageSelect(language);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialize = bootstrap.setupRequired;
  const ownBackground = useLoginBackground(documentBackground === undefined ? bootstrap.appearance : { type: "default", url: "", fit: "cover" });
  const background = documentBackground ?? ownBackground;
  const [glassTone, setGlassTone] = useState<"light" | "dark">("dark");
  const custom = bootstrap.appearance.type !== "default";
  const glass = custom && bootstrap.appearance.glassEnabled === true ? bootstrap.appearance.glass ?? "default" : "solid";
  const card = useGlassLight(glass !== "solid");
  const [initialBackground] = useState(background);
  const [opticalBackground, setOpticalBackground] = useState("");
  // Cached document images remain visible on the first logout paint. A first
  // download reveals the photo and its measured glass image in one transition.
  const ready = !!background && (background === initialBackground || glass === "solid" || background === opticalBackground);
  const style = background ? { backgroundImage: `url("${background}")`, backgroundSize: bootstrap.appearance.fit, backgroundRepeat: "no-repeat" } : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = initialize
        ? await initializeAdministrator({ bootstrapToken, username, password })
        : await login(username, password);
      onAuthenticated(session);
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "request_failed";
      const messages: Record<string, string> = {
        invalid_credentials: t("用户名或密码不正确。", "The username or password is incorrect."),
        invalid_bootstrap_token: t("一次性引导码无效。", "The one-time bootstrap token is invalid."),
        bootstrap_unavailable: t("服务器尚未生成一次性引导码。", "The server has not generated a bootstrap token."),
        too_many_attempts: t("尝试次数过多，请在 10min 后再试。", "Too many attempts. Try again in 10min."),
        invalid_username: t("用户名需为 3–64 位，并仅包含字母、数字、点、连字符或下划线。", "Use 3–64 letters, numbers, dots, hyphens, and underscores for the username."),
        weak_password: t("密码需为 12–512 位，并包含大小写字母、数字、符号中的至少三类。", "Use 12–512 characters and at least three of uppercase, lowercase, numbers, and symbols."),
        request_timeout: t("登录请求超时；服务器未确认操作，请重试。", "The sign-in request timed out and was not confirmed. Try again."),
        network_unavailable: t("无法连接登录服务；请检查网络或服务器状态。", "Cannot reach the sign-in service. Check the network or server."),
        service_unavailable: t("登录服务当前不可用，请稍后重试。", "The sign-in service is temporarily unavailable. Try again later."),
        upstream_unavailable: t("上游网关无法连接登录服务，请稍后重试。", "The gateway cannot reach the sign-in service. Try again later."),
      };
      setError(messages[code] ?? t("无法连接登录服务，请稍后重试。", "The sign-in service is unavailable. Try again later."));
    } finally {
      setBusy(false);
    }
  };

  return <main className={`auth-page ${custom ? "auth-page--custom" : ""}`} data-background-state={ready ? "ready" : "pending"} style={style}>
    {custom ? <div className="auth-background-placeholder" aria-hidden="true" /> : null}
    <section ref={card} className="auth-card" data-glass={glass} data-glass-tone={glassTone} aria-labelledby="auth-title">
      {glass !== "solid" ? <LiquidGlass background={background} fit={bootstrap.appearance.fit} preset={glass} onTone={setGlassTone} onReady={setOpticalBackground} /> : null}
      <div className="auth-brand"><span className="brand-mark"><Icon name="ac_unit" size={28} filled /></span><div><strong>CastoriceUI</strong><span>{t("VPS 控制台", "VPS Console")}</span></div></div>
      <div className="auth-heading"><span className="auth-heading__icon"><Icon name={initialize ? "rocket_launch" : "shield_person"} filled /></span><div><p>{initialize ? t("安全初始化", "Secure setup") : t("管理员登录", "Administrator sign in")}</p><h1 id="auth-title">{initialize ? t("创建第一个管理员", "Create the first administrator") : t("欢迎回来", "Welcome back")}</h1>{initialize ? <span>{t("验证服务器的一次性引导码后创建本地账号。", "Verify the server's one-time bootstrap token to create a local account.")}</span> : null}</div></div>
      {initialize && !bootstrap.bootstrapAvailable ? <div className="auth-warning" role="alert"><Icon name="warning" /><span>{t("服务器缺少一次性引导码。请先在服务器执行部署文档中的生成命令。", "The server is missing a bootstrap token. Run the generation command in the deployment guide first.")}</span></div> : null}
      <form onSubmit={(event) => void submit(event)}>
        {initialize ? <label className="field"><span>{t("一次性引导码", "One-time bootstrap token")}</span><div className="auth-input"><Icon name="key" size={20} /><input aria-label={t("一次性引导码", "One-time bootstrap token")} type="password" required autoComplete="one-time-code" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></div><small className="field-hint">{t("仅从服务器受限文件读取；创建管理员后立即失效。", "Read only from the protected server file; it expires after administrator creation.")}</small></label> : null}
        <label className="field"><span>{t("用户名", "Username")}</span><div className="auth-input"><Icon name="person" size={20} /><input aria-label={t("用户名", "Username")} required minLength={3} maxLength={64} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div></label>
        <label className="field"><span>{t("密码", "Password")}</span><div className="auth-input"><Icon name="lock" size={20} /><input aria-label={t("密码", "Password")} type="password" required minLength={initialize ? 12 : undefined} autoComplete={initialize ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></div>{initialize ? <small className="field-hint">{t("至少 12 位，并包含大小写字母、数字、符号中的三类。", "Use at least 12 characters and three of uppercase, lowercase, numbers, and symbols.")}</small> : null}</label>
        {error ? <div className="auth-error" role="alert"><Icon name="error" size={20} /><span>{error}</span></div> : null}
        <Button type="submit" icon={initialize ? "arrow_forward" : "login"} disabled={busy || (initialize && !bootstrap.bootstrapAvailable)}>{busy ? t("正在验证…", "Verifying…") : initialize ? t("创建并继续", "Create and continue") : t("登录", "Sign in")}</Button>
      </form>
      <div className="auth-footer auth-footer--language"><div className="auth-language-select"><MaterialSelect ariaLabel={languageLabel} triggerLabel={preference === "system" ? languageLabel : undefined} value={preference} options={languageOptions} onChange={(value) => { if (isLanguagePreference(value)) setPreference(value); }} /></div></div>
    </section>
  </main>;
}
