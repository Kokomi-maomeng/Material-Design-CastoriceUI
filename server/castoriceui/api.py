from __future__ import annotations

import hmac
import ipaddress
import json
import threading
import time
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from . import __version__
from .config import AppConfig
from .dashboard import DashboardService
from .security import list_background_images, normalize_https_image_url, safe_background_image
from .storage import Storage


SESSION_COOKIE = "castorice_session"
VISIBLE_PANELS = {"accounts", "connections", "traffic", "subscriptions", "network", "services", "alerts", "audit"}


class ApiHandler(BaseHTTPRequestHandler):
    server_version = f"CastoriceUI/{__version__}"

    @property
    def app(self) -> "ApiServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} {format_string % args}")

    def send_json(self, status: HTTPStatus, payload: Any, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def send_image(self, path: Path, mime: str) -> None:
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        if length <= 0:
            return {}
        if length > 65_536:
            raise ValueError("Request body exceeds 64 KiB")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value

    def require_mutation_header(self) -> bool:
        if self.headers.get("X-CastoriceUI-Request") != "1":
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "missing_request_guard"})
            return False
        if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "cross_site_request_rejected"})
            return False
        origin = self.headers.get("Origin", "").strip()
        host = self.headers.get("Host", "").strip().lower()
        if origin:
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.netloc.lower() != host:
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "origin_mismatch"})
                return False
        return True

    def source_ip(self) -> str:
        peer = self.client_address[0]
        try:
            if not ipaddress.ip_address(peer).is_loopback:
                return peer
            forwarded = self.headers.get("X-Real-IP", "").strip()
            return str(ipaddress.ip_address(forwarded)) if forwarded else peer
        except ValueError:
            return peer

    def session_token(self) -> str:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return ""
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else ""

    def current_session(self) -> dict[str, Any] | None:
        settings = self.app.storage.get_setting("ui_settings", {})
        idle_minutes = int(settings.get("idleTimeoutMinutes", 15)) if isinstance(settings, dict) else 15
        if idle_minutes not in {2, 5, 10, 15, 20, 30}:
            idle_minutes = 15
        return self.app.storage.session(self.session_token(), idle_minutes * 60)

    def require_session(self, mutation: bool = False) -> dict[str, Any] | None:
        session = self.current_session()
        if session is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "authentication_required"})
            return None
        if mutation:
            if not self.require_mutation_header():
                return None
            supplied = self.headers.get("X-CSRF-Token", "")
            if not supplied or not hmac.compare_digest(supplied, str(session["csrf_token"])):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "invalid_csrf_token"})
                return None
        return session

    def session_cookie(self, token: str, max_age: int) -> str:
        parts = [f"{SESSION_COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
        forwarded_https = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
        if self.app.config.secure_cookies or forwarded_https:
            parts.append("Secure")
        return "; ".join(parts)

    def login_appearance(self) -> dict[str, str]:
        value = self.app.storage.get_setting("login_background", {"type": "default", "value": ""})
        if not isinstance(value, dict):
            return {"type": "default", "url": ""}
        background_type = str(value.get("type", "default"))
        background_value = str(value.get("value", ""))
        try:
            if background_type == "url":
                return {"type": "url", "url": normalize_https_image_url(background_value, self.app.config.external_background_hosts)}
            if background_type == "server":
                safe_background_image(self.app.config.login_background_directory, background_value)
                return {"type": "server", "url": "/api/v2/auth/background"}
        except ValueError:
            return {"type": "default", "url": ""}
        return {"type": "default", "url": ""}

    def do_GET(self) -> None:
        parsed_request = urlparse(self.path)
        path = parsed_request.path.rstrip("/")
        if path in {"/api/v1/health", "/api/v2/health"}:
            self.send_json(HTTPStatus.OK, {"status": "ok", "version": __version__, "setupRequired": not self.app.storage.has_users()})
            return
        if path == "/api/v2/bootstrap":
            self.send_json(HTTPStatus.OK, {
                "setupRequired": not self.app.storage.has_users(),
                "bootstrapAvailable": self.app.bootstrap_available(),
                "appearance": self.login_appearance(),
            })
            return
        if path == "/api/v2/auth/background":
            setting = self.app.storage.get_setting("login_background", {})
            try:
                if not isinstance(setting, dict) or setting.get("type") != "server":
                    raise ValueError("No server background is selected")
                image_path, mime = safe_background_image(self.app.config.login_background_directory, str(setting.get("value", "")))
            except ValueError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "background_not_found"})
                return
            self.send_image(image_path, mime)
            return
        if path == "/api/v2/auth/session":
            session = self.require_session()
            if session is not None:
                self.send_json(HTTPStatus.OK, {
                    "username": session["username"],
                    "csrfToken": session["csrf_token"],
                    "expiresAt": session["expires_at"],
                    "setupComplete": bool(self.app.storage.get_setting("initial_setup_complete", False)),
                })
            return
        session = self.require_session()
        if session is None:
            return
        if path in {"/api/v1/dashboard", "/api/v2/dashboard"}:
            self.send_json(HTTPStatus.OK, self.app.dashboard.snapshot())
        elif path == "/api/v2/audits":
            try:
                query = parse_qs(parsed_request.query, keep_blank_values=True)
                page = int(query.get("page", ["1"])[0])
                page_size = int(query.get("pageSize", ["30"])[0])
                if page < 1 or page > 100_000 or page_size not in {30, 50}:
                    raise ValueError("Invalid audit pagination")
                search = query.get("search", [""])[0].strip()
                category = query.get("category", [""])[0].strip()
                if len(search) > 200 or category not in {"", "认证", "账号", "配置", "系统"}:
                    raise ValueError("Invalid audit filter")
                self.send_json(HTTPStatus.OK, self.app.dashboard.audit_page(page, page_size, search, category))
            except (TypeError, ValueError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        elif path.startswith("/api/v1/subscriptions/") and path.endswith("/url") or path.startswith("/api/v2/subscriptions/") and path.endswith("/url"):
            subscription_id = path.split("/")[-2]
            value = self.app.dashboard.subscription_url(subscription_id)
            if value:
                self.send_json(HTTPStatus.OK, {"url": value})
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "subscription_not_found"})
        elif path == "/api/v2/settings/background-options":
            configured = self.app.storage.get_setting("login_background", {"type": "default", "value": ""})
            self.send_json(HTTPStatus.OK, {"files": list_background_images(self.app.config.login_background_directory), "selected": self.login_appearance(), "configured": configured if isinstance(configured, dict) else {"type": "default", "value": ""}})
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_PUT(self) -> None:
        session = self.require_session(mutation=True)
        if session is None:
            return
        path = urlparse(self.path).path.rstrip("/")
        try:
            payload = self.read_json()
            if path in {"/api/v1/settings/traffic-limit", "/api/v2/settings/traffic-limit"}:
                value = int(payload.get("bytes", 0))
                if not 1_000_000_000 <= value <= 1_000_000_000_000_000:
                    raise ValueError("Traffic limit must be between 1 GB and 1 PB")
                self.app.storage.set_setting("traffic_limit_bytes", value)
                self.app.storage.add_audit("更新流量额度", "配置", "总流量额度已更新", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, {"ok": True, "bytes": value})
                return
            if path.startswith("/api/v1/integrations/") or path.startswith("/api/v2/integrations/"):
                integration_id = path.rsplit("/", 1)[-1]
                result = self.app.dashboard.configure_integration(integration_id, payload, self.source_ip())
                self.send_json(HTTPStatus.OK, result)
                return
            if path == "/api/v2/settings/network-targets":
                result = self.app.dashboard.update_network_targets(payload.get("targets"), self.source_ip(), str(session["username"]))
                self.send_json(HTTPStatus.OK, {"targets": result})
                return
            if path == "/api/v2/settings/ui":
                saved = self.app.storage.get_setting("ui_settings", {})
                if not isinstance(saved, dict):
                    saved = {}
                current = {"showSetup": True, "visiblePanels": sorted(VISIBLE_PANELS), "panelTitle": "CastoriceUI", "idleTimeoutMinutes": 15, **saved}
                if current.get("idleTimeoutMinutes") not in {2, 5, 10, 15, 20, 30}:
                    current["idleTimeoutMinutes"] = 15
                if "showSetup" in payload:
                    current["showSetup"] = bool(payload["showSetup"])
                if "visiblePanels" in payload:
                    panels = payload["visiblePanels"]
                    if not isinstance(panels, list) or any(str(item) not in VISIBLE_PANELS for item in panels):
                        raise ValueError("visiblePanels contains an unknown panel")
                    current["visiblePanels"] = list(dict.fromkeys(str(item) for item in panels))
                if "panelTitle" in payload:
                    panel_title = str(payload["panelTitle"]).strip()
                    if not panel_title or len(panel_title) > 40 or any(ord(character) < 32 for character in panel_title):
                        raise ValueError("panelTitle must contain 1 to 40 printable characters")
                    current["panelTitle"] = panel_title
                if "idleTimeoutMinutes" in payload:
                    idle_timeout = int(payload["idleTimeoutMinutes"])
                    if idle_timeout not in {2, 5, 10, 15, 20, 30}:
                        raise ValueError("idleTimeoutMinutes is not supported")
                    current["idleTimeoutMinutes"] = idle_timeout
                self.app.storage.set_setting("ui_settings", current)
                self.app.storage.add_audit("更新面板设置", "配置", "界面偏好设置已更新", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, current)
                return
            if path == "/api/v2/settings/login-background":
                background_type = str(payload.get("type", "default"))
                background_value = str(payload.get("value", ""))
                if background_type == "url":
                    background_value = normalize_https_image_url(background_value, self.app.config.external_background_hosts)
                elif background_type == "server":
                    safe_background_image(self.app.config.login_background_directory, background_value)
                elif background_type == "default":
                    background_value = ""
                else:
                    raise ValueError("Unknown background type")
                setting = {"type": background_type, "value": background_value}
                self.app.storage.set_setting("login_background", setting)
                self.app.storage.add_audit("更新登录背景", "配置", f"登录背景类型已设为 {background_type}", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, self.login_appearance())
                return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/api/v2/auth/initialize":
                payload = self.read_json()
                with self.app.authentication_lock:
                    if self.app.storage.has_users():
                        self.send_json(HTTPStatus.CONFLICT, {"error": "administrator_exists"})
                        return
                    if not self.app.login_allowed(self.source_ip()):
                        self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_attempts"})
                        return
                    if not self.app.verify_bootstrap(str(payload.get("bootstrapToken", ""))):
                        self.app.record_login_failure(self.source_ip())
                        self.send_json(HTTPStatus.FORBIDDEN, {"error": "invalid_bootstrap_token"})
                        return
                    user_id = self.app.storage.create_initial_user(str(payload.get("username", "")), str(payload.get("password", "")))
                    self.app.consume_bootstrap()
                token, csrf, expires_at = self.app.storage.create_session(user_id, self.app.config.session_lifetime_seconds)
                username = str(payload.get("username", "")).strip()
                self.app.clear_login_failures(self.source_ip())
                self.app.storage.add_audit("创建初始管理员", "认证", "首次安全初始化已完成", self.source_ip(), actor=username)
                self.send_json(HTTPStatus.CREATED, {"username": username, "csrfToken": csrf, "expiresAt": expires_at, "setupComplete": False}, {"Set-Cookie": self.session_cookie(token, self.app.config.session_lifetime_seconds)})
                return
            if path == "/api/v2/auth/login":
                if not self.app.storage.has_users():
                    self.send_json(HTTPStatus.CONFLICT, {"error": "initialization_required"})
                    return
                payload = self.read_json()
                with self.app.authentication_lock:
                    if not self.app.login_allowed(self.source_ip()):
                        self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_attempts"})
                        return
                    authenticated = self.app.storage.authenticate(str(payload.get("username", "")), str(payload.get("password", "")))
                    if authenticated is None:
                        self.app.record_login_failure(self.source_ip())
                        self.app.storage.add_audit("登录失败", "认证", "用户名或密码错误", self.source_ip(), result="失败", actor=str(payload.get("username", "unknown")))
                        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_credentials"})
                        return
                user_id, username = authenticated
                token, csrf, expires_at = self.app.storage.create_session(user_id, self.app.config.session_lifetime_seconds)
                self.app.clear_login_failures(self.source_ip())
                self.app.storage.add_audit("登录成功", "认证", "管理员会话已创建", self.source_ip(), actor=username)
                self.send_json(HTTPStatus.OK, {"username": username, "csrfToken": csrf, "expiresAt": expires_at, "setupComplete": bool(self.app.storage.get_setting("initial_setup_complete", False))}, {"Set-Cookie": self.session_cookie(token, self.app.config.session_lifetime_seconds)})
                return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        session = self.require_session(mutation=True)
        if session is None:
            return
        if path == "/api/v2/auth/logout":
            self.app.storage.delete_session(self.session_token())
            self.app.storage.add_audit("退出登录", "认证", "管理员会话已注销", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)})
            return
        if path == "/api/v2/initialization/complete":
            overrides = self.app.storage.get_setting("integration_overrides", {})
            system_values = overrides.get("system", {}).get("values", {}) if isinstance(overrides, dict) else {}
            traffic_values = overrides.get("traffic", {}).get("values", {}) if isinstance(overrides, dict) else {}
            if not str(system_values.get("nodeName", "")).strip() or not str(traffic_values.get("quotaGb", "")).strip():
                self.send_json(HTTPStatus.CONFLICT, {"error": "basic_setup_required"})
                return
            self.app.storage.set_setting("initial_setup_complete", True)
            self.app.storage.add_audit("完成初始化向导", "配置", "必要的面板设置已确认", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if (path.startswith("/api/v1/alerts/") or path.startswith("/api/v2/alerts/")) and path.endswith("/ack"):
            alert_id = path.split("/")[-2]
            if not self.app.storage.acknowledge(alert_id):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "active_alert_not_found"})
                return
            self.app.storage.add_audit("确认告警", "系统", f"告警 {alert_id} 已确认", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64
    max_request_workers = 32

    def __init__(self, config: AppConfig, storage: Storage, dashboard: DashboardService) -> None:
        self.config = config
        self.storage = storage
        self.dashboard = dashboard
        self.authentication_lock = threading.Lock()
        self.request_slots = threading.BoundedSemaphore(self.max_request_workers)
        super().__init__((config.listen_host, config.listen_port), ApiHandler)

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self.request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def bootstrap_available(self) -> bool:
        path = Path(self.config.bootstrap_token_path)
        try:
            return path.is_file() and 12 <= len(path.read_text(encoding="utf-8").strip()) <= 256
        except OSError:
            return False

    def verify_bootstrap(self, supplied: str) -> bool:
        path = Path(self.config.bootstrap_token_path)
        try:
            expected = path.read_text(encoding="utf-8").strip()
        except OSError:
            return False
        return bool(supplied) and hmac.compare_digest(supplied, expected)

    def consume_bootstrap(self) -> None:
        path = Path(self.config.bootstrap_token_path)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # The endpoint is permanently disabled once a user exists even if cleanup fails.
            pass

    def login_allowed(self, source_ip: str) -> bool:
        return self.storage.login_allowed(source_ip)

    def record_login_failure(self, source_ip: str) -> None:
        self.storage.record_login_failure(source_ip)

    def clear_login_failures(self, source_ip: str) -> None:
        self.storage.clear_login_failures(source_ip)
