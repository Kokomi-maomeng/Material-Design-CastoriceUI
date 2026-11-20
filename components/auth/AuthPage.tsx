import { useState, type FormEvent } from "react";
import type { BootstrapState, SessionState } from "../../lib/types";
import { initializeAdministrator, login } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { LanguageSelect } from "../ui/LanguageSelect";
import { useLoginBackground } from "./useLoginBackground";
import { LiquidGlass } from "./LiquidGlass";
import { useGlassLight } from "./useGlassLight";

export function AuthPage({ bootstrap, onAuthenticated, background: documentBackground, finishing = false, onSignInStart }: {
  bootstrap: BootstrapState;
  onAuthenticated: (session: SessionState) => void;
  background?: string;
  finishing?: boolean;
  onSignInStart?: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState("");
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

  const messages: Record<string, string> = {
    missing_bootstrapToken: t("请输入一次性引导码", "Enter the one-time bootstrap token"),
    missing_username: t("请输入用户名", "Enter your username"),
    missing_password: t("请输入密码", "Enter your password"),
    invalid_credentials: t("用户名或密码不正确", "The username or password is incorrect"),
    invalid_bootstrap_token: t("一次性引导码无效", "The one-time bootstrap token is invalid"),
    bootstrap_unavailable: t("服务器尚未生成一次性引导码", "The server has not generated a bootstrap token"),
    too_many_attempts: t("尝试次数过多，请过 10 分钟再试", "Too many attempts. Try again in 10 minutes"),
    authentication_busy: t("登录服务繁忙，请稍后重试", "Sign-in is busy. Try again shortly"),
    invalid_username: t("用户名需为 3–64 个字符，仅限字母、数字、点、连字符或下划线", "Use 3–64 characters: letters, numbers, dots, hyphens, or underscores"),
    weak_password: t("密码需为 12–512 个字符，并包含大写字母、小写字母、数字、符号中的至少三类", "Use 12–512 characters with at least three of uppercase letters, lowercase letters, numbers, and symbols"),
    request_timeout: t("请求超时。请刷新页面确认当前状态后重试", "The request timed out. Refresh to check the current state, then try again"),
    network_unavailable: t("无法连接登录服务，请检查网络或服务器状态", "Cannot reach the sign-in service. Check the network or server"),
    service_unavailable: t("登录服务当前不可用，请稍后重试", "Sign-in is temporarily unavailable. Try again later"),
    upstream_unavailable: t("上游网关无法连接登录服务，请稍后重试", "The gateway cannot reach the sign-in service. Try again later"),
  };
  const error = !errorCode ? "" : Object.hasOwn(messages, errorCode) ? messages[errorCode] : t("无法完成请求，请刷新页面后重试", "Could not complete the request. Refresh and try again");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || finishing || (initialize && !bootstrap.bootstrapAvailable)) return;
    const invalid = event.currentTarget.querySelector<HTMLInputElement>("input:invalid");
    if (invalid) {
      setErrorCode(invalid.validity.valueMissing ? `missing_${invalid.name}` : invalid.name === "username" ? "invalid_username" : "weak_password");
      invalid.focus();
      return;
    }
    setBusy(true);
    setErrorCode("");
    try {
      if (!initialize) onSignInStart?.();
      const session = initialize
        ? await initializeAdministrator({ bootstrapToken, username, password })
        : await login(username, password);
      onAuthenticated(session);
    } catch (caught) {
      setErrorCode(caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "request_failed");
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
      <form onSubmit={(event) => void submit(event)} noValidate>
        {initialize ? <label className="field"><span>{t("一次性引导码", "One-time bootstrap token")}</span><div className="auth-input"><Icon name="key" size={20} /><input name="bootstrapToken" aria-label={t("一次性引导码", "One-time bootstrap token")} type="password" required autoComplete="one-time-code" value={bootstrapToken} onChange={(event) => { setBootstrapToken(event.target.value); setErrorCode(""); }} /></div><small className="field-hint">{t("从服务器的受保护文件读取引导码。创建管理员后即失效。", "Read the token from the protected file on the server. It expires when the administrator is created.")}</small></label> : null}
        <label className="field"><span>{t("用户名", "Username")}</span><div className="auth-input"><Icon name="person" size={20} /><input name="username" aria-label={t("用户名", "Username")} required minLength={3} maxLength={64} autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setErrorCode(""); }} /></div></label>
        <label className="field"><span>{t("密码", "Password")}</span><div className="auth-input"><Icon name="lock" size={20} /><input name="password" aria-label={t("密码", "Password")} type="password" required minLength={initialize ? 12 : undefined} autoComplete={initialize ? "new-password" : "current-password"} value={password} onChange={(event) => { setPassword(event.target.value); setErrorCode(""); }} /></div>{initialize ? <small className="field-hint">{t("至少 12 个字符，包含大写字母、小写字母、数字、符号中的至少三类。", "Use at least 12 characters with at least three of uppercase letters, lowercase letters, numbers, and symbols.")}</small> : null}</label>
        {error ? <div className="auth-error" role="alert"><Icon name="error" size={20} /><span>{error}</span></div> : null}
        <Button type="submit" icon={initialize ? "arrow_forward" : "login"} disabled={busy || finishing || (initialize && !bootstrap.bootstrapAvailable)}>
          <span aria-live="polite">{finishing ? t("正在打开控制台…", "Opening the console…") : busy ? t("正在验证…", "Verifying…") : initialize ? t("创建并继续", "Create and continue") : t("登录", "Sign in")}</span>
        </Button>
      </form>
      <div className="auth-footer auth-footer--language"><div className="auth-language-select"><LanguageSelect compact /></div></div>
    </section>
  </main>;
}
