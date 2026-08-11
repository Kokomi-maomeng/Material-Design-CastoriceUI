import { useState, type FormEvent } from "react";
import type { BootstrapState, SessionState } from "../../lib/types";
import { initializeAdministrator, login } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export function AuthPage({ bootstrap, onAuthenticated }: { bootstrap: BootstrapState; onAuthenticated: (session: SessionState) => void }) {
  const { preference, setPreference, t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialize = bootstrap.setupRequired;
  const style = bootstrap.appearance.url ? { backgroundImage: `linear-gradient(135deg, rgb(22 18 39 / .62), rgb(48 33 82 / .48)), url("${bootstrap.appearance.url.replace(/["\\]/g, "")}")` } : undefined;

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
        too_many_attempts: t("尝试次数过多，请十分钟后再试。", "Too many attempts. Try again in ten minutes."),
      };
      setError(messages[code] ?? t("无法连接登录服务，请稍后重试。", "The sign-in service is unavailable. Try again later."));
    } finally {
      setBusy(false);
    }
  };

  return <main className={`auth-page ${bootstrap.appearance.url ? "auth-page--custom" : ""}`} style={style}>
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand"><span className="brand-mark"><Icon name="ac_unit" size={28} filled /></span><div><strong>CastoriceUI</strong><span>Material Design VPS Console</span></div></div>
      <div className="auth-heading"><span className="auth-heading__icon"><Icon name={initialize ? "rocket_launch" : "shield_person"} filled /></span><div><p>{initialize ? t("安全初始化", "Secure setup") : t("管理员登录", "Administrator sign in")}</p><h1 id="auth-title">{initialize ? t("创建第一个管理员", "Create the first administrator") : t("欢迎回来", "Welcome back")}</h1><span>{initialize ? t("验证服务器的一次性引导码后创建本地账号。", "Verify the server's one-time bootstrap token to create a local account.") : t("使用面板账号继续访问真实服务器数据。", "Use your panel account to access live server data.")}</span></div></div>
      {initialize && !bootstrap.bootstrapAvailable ? <div className="auth-warning" role="alert"><Icon name="warning" /><span>{t("服务器缺少一次性引导码。请先在服务器执行部署文档中的生成命令。", "The server is missing a bootstrap token. Run the generation command in the deployment guide first.")}</span></div> : null}
      <form onSubmit={(event) => void submit(event)}>
        {initialize ? <label className="field"><span>{t("一次性引导码", "One-time bootstrap token")}</span><div className="auth-input"><Icon name="key" size={20} /><input type="password" required autoComplete="one-time-code" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></div><small className="field-hint">{t("仅从服务器受限文件读取；创建管理员后立即失效。", "Read only from the protected server file; it expires after administrator creation.")}</small></label> : null}
        <label className="field"><span>{t("用户名", "Username")}</span><div className="auth-input"><Icon name="person" size={20} /><input required minLength={3} maxLength={64} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div></label>
        <label className="field"><span>{t("密码", "Password")}</span><div className="auth-input"><Icon name="lock" size={20} /><input type="password" required minLength={initialize ? 12 : undefined} autoComplete={initialize ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></div>{initialize ? <small className="field-hint">{t("至少 12 位，并包含大小写字母、数字、符号中的三类。", "Use at least 12 characters and three of uppercase, lowercase, numbers, and symbols.")}</small> : null}</label>
        {error ? <div className="auth-error" role="alert"><Icon name="error" size={20} /><span>{error}</span></div> : null}
        <Button type="submit" icon={initialize ? "arrow_forward" : "login"} disabled={busy || (initialize && !bootstrap.bootstrapAvailable)}>{busy ? t("正在验证…", "Verifying…") : initialize ? t("创建并继续", "Create and continue") : t("登录", "Sign in")}</Button>
      </form>
      <div className="auth-footer"><span><Icon name="lock" size={17} />{t("凭据只发送到当前面板后端", "Credentials are sent only to this panel backend")}</span><label><span className="sr-only">{t("语言", "Language")}</span><select value={preference} onChange={(event) => setPreference(event.target.value as "system" | "zh" | "en")}><option value="system">{t("跟随系统", "System")}</option><option value="zh">中文</option><option value="en">English</option></select></label></div>
    </section>
  </main>;
}
