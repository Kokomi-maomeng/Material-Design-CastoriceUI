from __future__ import annotations

import hmac
import hashlib
import ipaddress
import json
import os
import socket
import threading
import time
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from . import __version__
from .config import AppConfig
from .dashboard import DashboardService, VISIBLE_PANEL_ORDER, ordered_visible_panels
from .security import PublicFetchBusy, _image_mime, list_background_images, normalize_https_image_url, safe_background_image
from .background import BackgroundCache, BackgroundUnavailable, CACHE_SECONDS, DEFAULT_PROFILE, PROFILES, background_setting
from .storage import Storage


SESSION_COOKIE = "castorice_session"
VISIBLE_PANELS = set(VISIBLE_PANEL_ORDER)


class AuthenticationBusy(Exception):
    pass


def token_matches(supplied: str, expected: str) -> bool:
    return bool(supplied) and len(supplied) <= 256 and supplied.isascii() and expected.isascii() and hmac.compare_digest(supplied.encode("ascii"), expected.encode("ascii"))


def validation_error_payload(error: ValueError) -> dict[str, str]:
    if isinstance(error, PublicFetchBusy):
        return {"error": "subscription_check_incomplete", "message": "Some subscriptions were not checked because of local capacity or the 50-entry limit. Retry or reduce the protected list."}
    message = str(error)
    if message.startswith("Username must"):
        return {"error": "invalid_username", "field": "username", "message": message}
    if message.startswith("Password must"):
        return {"error": "weak_password", "field": "password", "message": message}
    lowered = message.casefold()
    if "background image api port" in lowered:
        return {"error": "invalid_background_port", "field": "value", "message": "Background image API port must be an integer from 1 to 65535"}
    if "configure" in lowered and "secret" in lowered and "protected server config" in lowered:
        return {"error": "missing_upstream_secret", "message": "Configure the required upstream secret in the protected server configuration"}
    mappings = (
        (("complete the required fields",), "missing_required_fields", "Complete all required fields before validating the integration"),
        (("inbound tag missing", "provide 1-20 sing-box inbound tags"), "inbound_tag_not_found", "Check that each configured inbound tag exists uniquely in the running core"),
        (("changed since startup", "config_not_loaded"), "protocol_probe_stale", "Reload the core through the operator's normal change procedure, then wait for a fresh protocol probe"),
        (("inventory unavailable", "check the protocol probe", "listener is unavailable"), "protocol_probe_unavailable", "Check the protocol probe service and confirm that its runtime evidence is fresh"),
        (("subscription",), "invalid_subscription", "Check the HTTPS publisher response and proxy-node format; client import and proxy connectivity remain unverified"),
        (("integration endpoint validation failed", "statistics api unavailable"), "upstream_unavailable", "Check the loopback API service, endpoint, and authentication configuration"),
        (("invalid response",), "upstream_invalid_response", "The upstream API responded, but its payload did not match the required format"),
    )
    for markers, code, safe_message in mappings:
        if any(marker in lowered for marker in markers):
            return {"error": code, "message": safe_message}
    return {"error": "invalid_request", "message": "The request could not be validated"}


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


from .validation import integer, boolean, text


class ApiHandler(BaseHTTPRequestHandler):
    server_version = f"CastoriceUI/{__version__}"

    @property
    def app(self) -> "ApiServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} {format_string % args}")

    def send_json(self, status: HTTPStatus, payload: Any, headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.write_response(status, body, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", **(headers or {})})

    def write_response(self, status: HTTPStatus, body: bytes, headers: dict[str, str]) -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # A browser reload or timeout closes the transport, not the collector.
            self.close_connection = True

    def send_image(self, path: Path, mime: str) -> None:
        self.stream_image(path, mime)

    def stream_image(self, path: Path, mime: str, stale: bool = False, retry_after: int = 0, fetched_at: float = 0) -> None:
        try:
            with path.open("rb") as stream:
                # An atomic refresh may replace this path between get() and
                # open(). Describe the actual opened file, not older metadata.
                mime = _image_mime(stream.read(16))
                stream.seek(0)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(os.fstat(stream.fileno()).st_size))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
                if fetched_at:
                    self.send_header("X-Background-Age", str(round(max(0, time.time() - fetched_at), 3)))
                if stale:
                    self.send_header("X-Background-Stale", "1")
                    self.send_header("Retry-After", str(retry_after))
                self.end_headers()
                while chunk := stream.read(65_536):
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        if length < 0:
            raise ValueError("Invalid Content-Length")
        if length == 0:
            return {}
        if length > 65_536:
            raise ValueError("Request body exceeds 64 KiB")
        value = json.loads(self.rfile.read(length), parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("Non-finite JSON number")))
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
        idle_minutes = settings.get("idleTimeoutMinutes", 15) if isinstance(settings, dict) else 15
        if type(idle_minutes) is not int:
            idle_minutes = 15
        if idle_minutes not in {2, 5, 10, 15, 20, 30}:
            idle_minutes = 15
        return self.app.storage.session(self.session_token(), idle_minutes * 60, touch=False)

    def require_session(self, mutation: bool = False) -> dict[str, Any] | None:
        session = self.current_session()
        if session is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "authentication_required"})
            return None
        if mutation:
            if not self.require_mutation_header():
                return None
            supplied = self.headers.get("X-CSRF-Token", "")
            if not token_matches(supplied, str(session["csrf_token"])):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "invalid_csrf_token"})
                return None
            self.app.storage.session(self.session_token(), touch=True)
        return session

    def session_cookie(self, token: str, max_age: int) -> str:
        parts = [f"{SESSION_COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
        forwarded_https = self.headers.get("X-Forwarded-Proto", "").lower() == "https"
        if self.app.config.secure_cookies or forwarded_https:
            parts.append("Secure")
        return "; ".join(parts)

    def login_appearance(self) -> dict[str, Any]:
        value = background_setting(self.app.storage.get_setting("login_background", {}))
        appearance = {key: item for key, item in value.items() if key != "value"}
        appearance["url"] = ""
        # Optical settings do not change image bytes. Reuse the decoded photo
        # when enabling glass, changing its preset or changing the image fit.
        source = {key: value[key] for key in ("type", "value")}
        appearance["revision"] = hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()[:20]
        try:
            if value["type"] == "url":
                normalize_https_image_url(value["value"], self.app.config.external_background_hosts)
                appearance["url"] = "/api/v2/auth/background"
            elif value["type"] == "server":
                safe_background_image(self.app.config.login_background_directory, value["value"])
                appearance["url"] = "/api/v2/auth/background"
        except ValueError:
            appearance["type"] = "default"
        return appearance

    def do_GET(self) -> None:
        parsed_request = urlparse(self.path)
        path = parsed_request.path.rstrip("/")
        if path in {"/api/v1/health", "/api/v2/health"}:
            self.send_json(HTTPStatus.OK, {"status": "ok", "version": __version__, "setupRequired": not self.app.storage.has_users(), "scope": "panel-liveness"})
            return
        if path == "/api/v2/bootstrap":
            self.send_json(HTTPStatus.OK, {
                "setupRequired": not self.app.storage.has_users(),
                "bootstrapAvailable": self.app.bootstrap_available(),
                "appearance": self.login_appearance(),
            })
            return
        if path == "/api/v2/auth/background":
            setting = background_setting(self.app.storage.get_setting("login_background", {}))
            try:
                profile = parse_qs(parsed_request.query).get("profile", [DEFAULT_PROFILE])[0]
                if profile not in PROFILES:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_background_profile"})
                    return
                if setting.get("type") == "server":
                    image_path, mime = safe_background_image(self.app.config.login_background_directory, str(setting.get("value", "")))
                    self.send_image(image_path, mime)
                    return
                if setting.get("type") == "url":
                    # A failed browser decode may retry a corrupt cached image;
                    # this uses the same global fetch/byte/concurrency budgets.
                    seconds = 0 if parse_qs(parsed_request.query).get("retry") == ["1"] else setting["cacheSeconds"]
                    image = self.app.backgrounds.get(setting["value"], self.app.config.external_background_hosts, profile, seconds)
                    self.stream_image(image.path, image.mime, image.stale, image.retry_after, image.fetched_at)
                    return
                raise ValueError("No background is selected")
            except BackgroundUnavailable as error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "background_temporarily_unavailable"}, {"Retry-After": str(error.retry_after)})
                return
            except (ValueError, OSError):
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
        elif path == "/api/v2/alerts":
            try:
                query = parse_qs(parsed_request.query, keep_blank_values=True)
                page = int(query.get("page", ["1"])[0])
                page_size = int(query.get("pageSize", ["30"])[0])
                alert_filter = query.get("filter", ["all"])[0]
                if page < 1 or page > 100_000 or page_size not in {30, 50} or alert_filter not in {"pending", "all", "active", "recovered"}:
                    raise ValueError("Invalid alert pagination or filter")
                self.send_json(HTTPStatus.OK, self.app.storage.alert_page(page, page_size, alert_filter == "pending", query.get("status", [alert_filter])[0], query.get("severity", [""])[0], query.get("start", [""])[0], query.get("end", [""])[0]))
            except (TypeError, ValueError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        elif path.startswith("/api/v2/alerts/") and path.endswith("/evidence"):
            episode_id = path.removeprefix("/api/v2/alerts/").removesuffix("/evidence")
            if not episode_id or len(episode_id) > 80 or not all(c.isascii() and (c.isalnum() or c in "-_") for c in episode_id):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_episode_id"})
            else:
                evidence = self.app.storage.episode_evidence(episode_id)
                self.send_json(HTTPStatus.OK if evidence else HTTPStatus.NOT_FOUND, evidence or {"error": "episode_not_found"})
        elif path.startswith("/api/v2/network/") and path.endswith("/history"):
            target_id = path.removeprefix("/api/v2/network/").removesuffix("/history")
            with self.app.dashboard.lock:
                known = any(item["id"] == target_id for item in self.app.dashboard.runtime_cache.get("network", []))
            if not known:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "target_not_found"})
                return
            try:
                query = parse_qs(parsed_request.query)
                history = self.app.storage.network_time_history(target_id, int(query.get("hours", ["1"])[0]), int(query.get("ipVersion", ["0"])[0]))
                self.send_json(HTTPStatus.OK, history)
            except (TypeError, ValueError):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_history_range"})
        elif path == "/api/v2/monitoring":
            runtime = self.app.dashboard.runtime_cache
            self.send_json(HTTPStatus.OK, {"freshness": self.app.dashboard.collection_freshness(), "services": runtime.get("services", []), "maintenance": runtime.get("maintenance", {"state": "unavailable"}), "networkCorrelation": runtime.get("networkCorrelation", {}), "officialStatus": runtime.get("officialStatus", {"status": "not_checked"}), "resource": self.app.storage.monitoring_history("resource", limit=12), "scope": {"panel": "liveness", "core": "systemd and owned listeners", "statistics": "local APIs"}})
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
            configured = background_setting(self.app.storage.get_setting("login_background", {}))
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
                quota_setting = self.app.dashboard.update_traffic_quota(payload)
                self.app.storage.add_audit("更新流量额度", "配置", "总流量额度已更新", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, {"ok": True, **quota_setting})
                return
            if path.startswith("/api/v1/integrations/") or path.startswith("/api/v2/integrations/"):
                integration_id = path.rsplit("/", 1)[-1]
                result = self.app.dashboard.configure_integration(integration_id, payload, self.source_ip(), str(session["username"]))
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
                    current["showSetup"] = boolean(payload["showSetup"], "showSetup")
                if "visiblePanels" in payload:
                    panels = payload["visiblePanels"]
                    if not isinstance(panels, list) or any(str(item) not in VISIBLE_PANELS for item in panels):
                        raise ValueError("visiblePanels contains an unknown panel")
                    current["visiblePanels"] = ordered_visible_panels(list(dict.fromkeys(str(item) for item in panels)))
                if "panelTitle" in payload:
                    panel_title = text(payload["panelTitle"], "panelTitle").strip()
                    if not panel_title or len(panel_title) > 40 or any(ord(character) < 32 for character in panel_title):
                        raise ValueError("panelTitle must contain 1 to 40 printable characters")
                    current["panelTitle"] = panel_title
                if "idleTimeoutMinutes" in payload:
                    idle_timeout = integer(payload["idleTimeoutMinutes"], "idleTimeoutMinutes")
                    if idle_timeout not in {2, 5, 10, 15, 20, 30}:
                        raise ValueError("idleTimeoutMinutes is not supported")
                    current["idleTimeoutMinutes"] = idle_timeout
                self.app.storage.set_setting("ui_settings", current)
                self.app.storage.add_audit("更新面板设置", "配置", "界面偏好设置已更新", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, current)
                return
            if path == "/api/v2/settings/login-background":
                background_type = text(payload.get("type", "default"), "type")
                background_value = text(payload.get("value", ""), "value")
                fit = text(payload.get("fit", "cover"), "fit")
                seconds = payload.get("cacheSeconds", 0)
                if type(seconds) is not int:
                    raise ValueError("cacheSeconds must be an integer")
                glass = text(payload.get("glass", "default"), "glass")
                glass_enabled = boolean(payload.get("glassEnabled", False), "glassEnabled")
                if fit not in {"cover", "contain"} or seconds not in CACHE_SECONDS or glass not in {"clear", "default", "tinted"}:
                    raise ValueError("Invalid background appearance")
                if background_type == "url":
                    background_value = normalize_https_image_url(background_value, self.app.config.external_background_hosts)
                elif background_type == "server":
                    safe_background_image(self.app.config.login_background_directory, background_value)
                elif background_type == "default":
                    background_value = ""
                else:
                    raise ValueError("Unknown background type")
                setting = {"type": background_type, "value": background_value, "fit": fit, "cacheSeconds": seconds, "glass": glass, "glassEnabled": glass_enabled}
                self.app.storage.set_setting("login_background", setting)
                self.app.storage.add_audit("更新登录背景", "配置", f"登录背景类型已设为 {background_type}", self.source_ip(), actor=str(session["username"]))
                self.send_json(HTTPStatus.OK, self.login_appearance())
                return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE if isinstance(error, PublicFetchBusy) else HTTPStatus.BAD_REQUEST, validation_error_payload(error) if isinstance(error, ValueError) else {"error": "invalid_json"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            if path == "/api/v2/auth/initialize":
                payload = self.read_json()
                with self.app.authentication_gate():
                    if self.app.storage.has_users():
                        self.send_json(HTTPStatus.CONFLICT, {"error": "administrator_exists"})
                        return
                    if not self.app.login_allowed(self.source_ip()):
                        self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_attempts"})
                        return
                    if not self.app.verify_bootstrap(text(payload.get("bootstrapToken", ""), "bootstrapToken")):
                        self.app.record_login_failure(self.source_ip())
                        self.send_json(HTTPStatus.FORBIDDEN, {"error": "invalid_bootstrap_token"})
                        return
                    user_id = self.app.storage.create_initial_user(text(payload.get("username", ""), "username"), text(payload.get("password", ""), "password"))
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
                with self.app.authentication_gate():
                    if not self.app.login_allowed(self.source_ip()):
                        self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "too_many_attempts"})
                        return
                    authenticated = self.app.storage.authenticate(text(payload.get("username", ""), "username"), text(payload.get("password", ""), "password"))
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
        except AuthenticationBusy:
            self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "authentication_busy"}, {"Retry-After": "2"})
            return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, validation_error_payload(error) if isinstance(error, ValueError) else {"error": "invalid_json"})
            return

        session = self.require_session(mutation=True)
        if session is None:
            return
        if path == "/api/v2/auth/logout":
            self.app.storage.delete_session(self.session_token())
            self.app.storage.add_audit("退出登录", "认证", "管理员会话已注销", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)})
            return
        if path == "/api/v2/auth/activity":
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if path == "/api/v2/auth/change-password":
            try:
                payload = self.read_json()
                with self.app.authentication_gate():
                    changed = self.app.storage.change_password(
                        int(session["user_id"]),
                        text(payload.get("currentPassword", ""), "currentPassword"),
                        text(payload.get("newPassword", ""), "newPassword"),
                        self.session_token(),
                    )
            except AuthenticationBusy:
                self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "authentication_busy"}, {"Retry-After": "2"})
                return
            except (ValueError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, validation_error_payload(error) if isinstance(error, ValueError) else {"error": "invalid_json"})
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
            configured_system = overrides.get("system", {}) if isinstance(overrides, dict) else {}
            if not isinstance(configured_system, dict):
                configured_system = {}
            system_values = configured_system.get("values", {})
            quota = self.app.storage.get_setting("traffic_quota", {})
            traffic = overrides.get("traffic", {}) if isinstance(overrides, dict) else {}
            confirmed = self.app.storage.get_setting("traffic_quota_confirmed", False) or isinstance(traffic, dict) and traffic.get("configured")
            if not isinstance(system_values, dict) or not str(system_values.get("nodeName", "")).strip() or not configured_system.get("configured") or not confirmed or not isinstance(quota, dict) or type(quota.get("bytes")) is not int or not 1_000_000_000 <= quota["bytes"] <= 1_000_000_000_000_000:
                self.send_json(HTTPStatus.CONFLICT, {"error": "basic_setup_required"})
                return
            self.app.storage.set_setting("initial_setup_complete", True)
            self.app.storage.add_audit("完成初始化向导", "配置", "必要的面板设置已确认", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if path == "/api/v2/alerts/ack-all":
            count = self.app.storage.acknowledge_all()
            self.app.storage.add_audit("确认全部告警", "系统", f"已确认 {count} 条告警", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True, "count": count})
            return
        if (path.startswith("/api/v1/alerts/") or path.startswith("/api/v2/alerts/")) and path.endswith("/ack"):
            alert_id = path.split("/")[-2]
            if not self.app.storage.acknowledge(alert_id):
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "alert_not_found"})
                return
            self.app.storage.add_audit("确认告警", "系统", f"告警 {alert_id} 已确认", self.source_ip(), actor=str(session["username"]))
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64
    max_request_workers = 16

    def __init__(self, config: AppConfig, storage: Storage, dashboard: DashboardService) -> None:
        self.config = config
        self.storage = storage
        self.dashboard = dashboard
        self.authentication_lock = threading.Lock()
        self.authentication_slots = threading.BoundedSemaphore(2)
        self.backgrounds = BackgroundCache(Path(config.database_path).parent / "background-cache")
        old_background = storage.get_setting("login_background", {})
        migrated_background = background_setting(old_background)
        if old_background != migrated_background:
            storage.set_setting("login_background", migrated_background)
        self.request_slots = threading.BoundedSemaphore(self.max_request_workers)
        try:
            if ipaddress.ip_address(config.listen_host).version == 6:
                self.address_family = socket.AF_INET6
        except ValueError:
            pass
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
        return token_matches(supplied, expected)

    @contextmanager
    def authentication_gate(self):
        # At most one expensive password operation plus one waiting request.
        # Distributed failures cannot impose a persistent global account lock.
        if not self.authentication_slots.acquire(blocking=False):
            raise AuthenticationBusy()
        try:
            with self.authentication_lock:
                yield
        finally:
            self.authentication_slots.release()

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
