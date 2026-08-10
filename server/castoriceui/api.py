from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .config import AppConfig
from .dashboard import DashboardService
from .storage import Storage


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "CastoriceUI/1.2"

    @property
    def app(self) -> "ApiServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} {format_string % args}")

    def send_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        length = min(int(self.headers.get("Content-Length", "0")), 65_536)
        if length <= 0:
            return {}
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value

    def do_GET(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path == "/api/v1/health":
            self.send_json(HTTPStatus.OK, {"status": "ok", "version": "1.2.0"})
        elif path == "/api/v1/dashboard":
            self.send_json(HTTPStatus.OK, self.app.dashboard.snapshot())
        elif path.startswith("/api/v1/subscriptions/") and path.endswith("/url"):
            subscription_id = path.split("/")[-2]
            value = self.app.dashboard.subscription_url(subscription_id)
            if value:
                self.send_json(HTTPStatus.OK, {"url": value})
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "subscription_not_found"})
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_PUT(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        try:
            payload = self.read_json()
            if path == "/api/v1/settings/traffic-limit":
                value = int(payload.get("bytes", 0))
                if value < 1_000_000_000:
                    raise ValueError("Traffic limit must be at least 1 GB")
                self.app.storage.set_setting("traffic_limit_bytes", value)
                self.app.storage.add_audit("更新流量额度", "配置", "月度总流量额度已更新", self.client_address[0])
                self.send_json(HTTPStatus.OK, {"ok": True})
                return
            if path.startswith("/api/v1/integrations/"):
                integration_id = path.rsplit("/", 1)[-1]
                result = self.app.dashboard.configure_integration(integration_id, payload)
                self.send_json(HTTPStatus.OK, result)
                return
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/api/v1/alerts/") and path.endswith("/ack"):
            alert_id = path.split("/")[-2]
            self.app.storage.acknowledge(alert_id)
            self.app.storage.add_audit("确认告警", "系统", f"告警 {alert_id} 已确认", self.client_address[0])
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})


class ApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, config: AppConfig, storage: Storage, dashboard: DashboardService) -> None:
        self.config = config
        self.storage = storage
        self.dashboard = dashboard
        super().__init__((config.listen_host, config.listen_port), ApiHandler)
