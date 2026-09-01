from __future__ import annotations

import hmac
import ipaddress
import json
import threading
import time
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import __version__
from .config import AppConfig
from .collectors import traffic_quota_period
from .dashboard import DashboardService, VISIBLE_PANEL_ORDER, ordered_visible_panels
from .security import fetch_https_image_api, list_background_images, normalize_https_image_url, safe_background_image
from .storage import Storage


SESSION_COOKIE = "castorice_session"
VISIBLE_PANELS = set(VISIBLE_PANEL_ORDER)


def normalized_origin(scheme: str, authority: str, port_hint: str = "") -> tuple[str, str, int] | None:
    """Return a comparable origin tuple without dropping non-standard ports."""
    scheme = scheme.strip().lower()
    if scheme not in {"http", "https"} or not authority or "," in authority:
        return None
    parsed = urlparse(f"{scheme}://{authority.strip()}")
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        return None
    try:
        port = parsed.port
        if port is None and port_hint:
            port = int(port_hint)
    except ValueError:
        return None
    return scheme, parsed.hostname.lower(), port or (443 if scheme == "https" else 80)


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
        self.send_image_bytes(path.read_bytes(), mime)

    def send_image_bytes(self, body: bytes, mime: str) -> None:
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
        if origin:
            parsed = urlparse(origin)
            try:
                peer_is_loopback = ipaddress.ip_address(self.client_address[0]).is_loopback
            except (AttributeError, ValueError):
                peer_is_loopback = False
            forwarded_scheme = self.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip() if peer_is_loopback else ""
            forwarded_host = self.headers.get("X-Forwarded-Host", "").strip() if peer_is_loopback else ""
            forwarded_port = self.headers.get("X-Forwarded-Port", "").strip() if peer_is_loopback else ""
            supplied = normalized_origin(parsed.scheme, parsed.netloc)
            expected = normalized_origin(
                forwarded_scheme or parsed.scheme,
                forwarded_host or self.headers.get("Host", ""),
                forwarded_port,
            )
            if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment or supplied is None or supplied != expected:
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
            return {"type": "default", "url": "", "fit": "cover", "position": "center"}
        background_type = str(value.get("type", "default"))
        background_value = str(value.get("value", ""))
        fit = str(value.get("fit", "cover")) if value.get("fit") in {"cover", "contain"} else "cover"
        position = str(value.get("position", "center")) if value.get("position") in {"center", "top", "bottom", "left", "right"} else "center"
        try:
            if background_type == "url":
                normalize_https_image_url(background_value, self.app.config.external_background_hosts)
                return {"type": "url", "url": "/api/v2/auth/background", "fit": fit, "position": position}
            if background_type == "server":
                safe_background_image(self.app.config.login_background_directory, background_value)
                return {"type": "server", "url": "/api/v2/auth/background", "fit": fit, "position": position}
        except ValueError:
            return {"type": "default", "url": "", "fit": "cover", "position": "center"}
        return {"type": "default", "url": "", "fit": "cover", "position": "center"}

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
                if not isinstance(setting, dict):
                    raise ValueError("No server background is selected")
                if setting.get("type") == "server":
                    image_path, mime = safe_background_image(self.app.config.login_background_directory, str(setting.get("value", "")))
                    self.send_image(image_path, mime)
                    return
                if setting.get("type") == "url":
                    body, mime = self.app.remote_background(str(setting.get("value", "")))
                    self.send_image_bytes(body, mime)
                    return
                raise ValueError("No background is selected")
            except ValueError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "background_not_found"})
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
            try:
                self.send_json(HTTPStatus.OK, self.app.dashboard.snapshot())
            except Exception as error:
                print(f"Dashboard snapshot failed: {type(error).__name__}")
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "dashboard_unavailable"})
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
            self.send_json(HTTPStatus.OK, {"files": list_background_images(self.app.config.login_background_directory), "directory": self.app.config.login_background_directory, "selected": self.login_appearance(), "configured": configured if isinstance(configured, dict) else {"type": "default", "value": ""}})
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
                previous = self.app.storage.get_setting("traffic_quota", {})
                if not isinstance(previous, dict):
                    previous = {}
                auto_reset = bool(payload.get("autoReset", previous.get("autoReset", False)))
                period_unit = str(payload.get("periodUnit", previous.get("periodUnit", "month")))
                if period_unit not in {"day", "week", "month", "year"}:
                    raise ValueError("periodUnit must be day, week, month, or year")
                period_count = int(payload.get("periodCount", previous.get("periodCount", 1)))
                if not 1 <= period_count <= 365:
                    raise ValueError("periodCount must be between 1 and 365")
                reset_anchor = date.fromisoformat(str(payload.get("resetAnchor", previous.get("resetAnchor", f"2000-01-{self.app.config.traffic_billing_day:02d}"))))
                reset_time = str(payload.get("resetTime", previous.get("resetTime", "00:00"))).strip()
                try:
                    datetime.strptime(reset_time, "%H:%M")
                except ValueError as error:
                    raise ValueError("resetTime must use 24-hour HH:MM") from error
                timezone_name = str(payload.get("timezone", previous.get("timezone", self.app.config.traffic_billing_timezone))).strip() or "UTC"
                try:
                    if timezone_name != "UTC":
                        ZoneInfo(timezone_name)
                except (ZoneInfoNotFoundError, TypeError) as error:
                    raise ValueError("timezone must be UTC or an installed IANA timezone") from error
                fixed_cycle_start = ""
                if not auto_reset:
                    if not bool(previous.get("autoReset", False)) and previous.get("fixedCycleStart"):
                        fixed_cycle_start = str(previous["fixedCycleStart"])
                    else:
                        current_start, _, _ = traffic_quota_period(
                            datetime.now(timezone.utc), previous, self.app.config.traffic_billing_day, self.app.config.traffic_billing_timezone
                        )
                        fixed_cycle_start = current_start.isoformat().replace("+00:00", "Z")
                quota_setting = {
                    "autoReset": auto_reset,
                    "periodUnit": period_unit,
                    "periodCount": period_count,
                    "resetAnchor": reset_anchor.isoformat(),
                    "resetTime": reset_time,
                    "timezone": timezone_name,
                }
                if fixed_cycle_start:
                    quota_setting["fixedCycleStart"] = fixed_cycle_start
                self.app.storage.set_setting("traffic_limit_bytes", value)
                self.app.storage.set_setting("traffic_quota", quota_setting)
                self.app.storage.add_audit("更新流量额度", "配置", "总流量额度已更新", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, {"ok": True, "bytes": value, **quota_setting})
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
                current = {"showSetup": True, "visiblePanels": list(VISIBLE_PANEL_ORDER), "panelTitle": "CastoriceUI", "idleTimeoutMinutes": 15, **saved}
                current["visiblePanels"] = ordered_visible_panels(current.get("visiblePanels"))
                if current.get("idleTimeoutMinutes") not in {2, 5, 10, 15, 20, 30}:
                    current["idleTimeoutMinutes"] = 15
                if "showSetup" in payload:
                    current["showSetup"] = bool(payload["showSetup"])
                if "visiblePanels" in payload:
                    panels = payload["visiblePanels"]
                    if not isinstance(panels, list) or any(str(item) not in VISIBLE_PANELS for item in panels):
                        raise ValueError("visiblePanels contains an unknown panel")
                    current["visiblePanels"] = ordered_visible_panels(list(dict.fromkeys(str(item) for item in panels)))
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
                fit = str(payload.get("fit", "cover"))
                position = str(payload.get("position", "center"))
                if fit not in {"cover", "contain"} or position not in {"center", "top", "bottom", "left", "right"}:
                    raise ValueError("Invalid background fit or position")
                if background_type == "url":
                    background_value = normalize_https_image_url(background_value, self.app.config.external_background_hosts)
                elif background_type == "server":
                    safe_background_image(self.app.config.login_background_directory, background_value)
                elif background_type == "default":
                    background_value = ""
                else:
                    raise ValueError("Unknown background type")
                setting = {"type": background_type, "value": background_value, "fit": fit, "position": position}
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
        if path == "/api/v2/auth/change-password":
            try:
                payload = self.read_json()
                changed = self.app.storage.change_password(
                    int(session["user_id"]),
                    str(payload.get("currentPassword", "")),
                    str(payload.get("newPassword", "")),
                    self.session_token(),
                )
            except (ValueError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if not changed:
                self.app.storage.add_audit("修改密码失败", "认证", "旧密码验证失败", self.source_ip(), result="失败", actor=str(session["username"]))
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_current_password"})
                return
            self.app.storage.add_audit("修改密码", "认证", "管理员密码已更新，其他会话已失效", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True})
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
        self.background_cache_lock = threading.Lock()
        self.background_cache: tuple[str, float, bytes, str] | None = None
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

    def remote_background(self, url: str) -> tuple[bytes, str]:
        normalized = normalize_https_image_url(url, self.config.external_background_hosts)
        with self.background_cache_lock:
            if self.background_cache and self.background_cache[0] == normalized and self.background_cache[1] > time.monotonic():
                return self.background_cache[2], self.background_cache[3]
        body, mime, _ = fetch_https_image_api(normalized, self.config.external_background_hosts)
        with self.background_cache_lock:
            self.background_cache = (normalized, time.monotonic() + 900, body, mime)
        return body, mime
