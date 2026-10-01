"""Behavioral regressions for the A44 audit; no production credentials."""
from __future__ import annotations

import copy
import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.api import ApiServer
from castoriceui.collectors import hysteria_snapshot, singbox_snapshot, detect_interface, ping_target
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.security import _parse_subscription, _public_https_get
from castoriceui.storage import Storage


def system_fixture() -> dict:
    return {"nodeName": "Synthetic QA", "cpuPercent": 10, "cpuCores": 2, "memoryPercent": 20,
            "memoryUsedBytes": 20, "memoryTotalBytes": 100, "diskPercent": 10, "diskUsedBytes": 10,
            "diskTotalBytes": 100, "load": [0, 0, 0], "uptimeSeconds": 10,
            "trafficUsedBytes": 0, "trafficLimitBytes": 1_000_000_000, "databaseWritable": True,
            "interface": "eth0", "kernel": "synthetic", "downloadBps": 0, "uploadBps": 0,
            "databaseBytes": 1, "observedAt": datetime.now(timezone.utc).isoformat()}


class AuditRegressions(unittest.TestCase):
    def test_public_fetch_dns_and_address_retries_share_one_deadline(self) -> None:
        def slow_dns(*_args):
            time.sleep(0.15)
            return ["8.8.8.8"]
        started = time.monotonic()
        with patch("castoriceui.security._require_public_host", side_effect=slow_dns):
            with self.assertRaises(TimeoutError):
                _public_https_get("https://example.com/", {}, 1024, 0.04)
        self.assertLess(time.monotonic() - started, 0.12)
        time.sleep(0.17)
        class SlowConnection:
            sock = None
            def __init__(self, *_args): pass
            def request(self, *_args, **_kwargs): time.sleep(0.035); raise OSError("synthetic")
            def close(self): pass
        started = time.monotonic()
        with patch("castoriceui.security._require_public_host", return_value=["8.8.8.8"] * 10), patch("castoriceui.security._PinnedHTTPSConnection", SlowConnection):
            with self.assertRaises(TimeoutError):
                _public_https_get("https://example.com/", {}, 1024, 0.07)
        self.assertLess(time.monotonic() - started, 0.16)

    def test_automatic_ping_keeps_preference_and_exposes_actual_family(self) -> None:
        class Completed:
            stdout = "PING example.com (2001:4860:4860::8888): 56 data bytes\n64 bytes: time=10 ms\n0% packet loss"
            stderr = ""
        with patch("castoriceui.collectors.shutil.which", return_value="/bin/ping"), patch("castoriceui.collectors.subprocess.run", return_value=Completed()) as process:
            result = ping_target({"id": "qa", "address": "example.com", "ipVersion": 0})
        self.assertEqual(result["ipVersion"], 0)
        self.assertEqual(result["resolvedIpVersion"], 6)
        self.assertNotIn("-4", process.call_args.args[0])
        self.assertNotIn("-6", process.call_args.args[0])

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.config = AppConfig(database_path=str(root / "state.db"), bootstrap_token_path=str(root / "bootstrap"), secure_cookies=False, listen_port=0)
        self.storage = Storage(self.config.database_path)
        self.dashboard = DashboardService(self.config, self.storage)
        self.server = None

    def tearDown(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(2)
        self.directory.cleanup()

    def start_api(self) -> None:
        Path(self.config.bootstrap_token_path).write_text("synthetic-first-run-token")
        self.server = ApiServer(self.config, self.storage, self.dashboard)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.cookie = self.csrf = ""

    def call(self, method: str, path: str, payload: object = None) -> tuple[int, dict]:
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        headers = {"Content-Type": "application/json", "Cookie": self.cookie, "X-CastoriceUI-Request": "1", "X-CSRF-Token": self.csrf}
        connection.request(method, path, json.dumps(payload) if payload is not None else None, headers)
        response = connection.getresponse()
        body = json.loads(response.read())
        if response.getheader("Set-Cookie"):
            self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
        if body.get("csrfToken"):
            self.csrf = body["csrfToken"]
        status = response.status
        connection.close()
        return status, body

    def initialize(self) -> None:
        status, _ = self.call("POST", "/api/v2/auth/initialize", {"bootstrapToken": "synthetic-first-run-token", "username": "qa-admin", "password": "Synthetic-Password-123!"})
        self.assertEqual(status, 201)

    def test_first_run_real_http_then_service_recreation_and_login(self) -> None:
        self.start_api()
        self.initialize()
        self.assertEqual(self.call("POST", "/api/v2/initialization/complete")[0], 409)
        with patch.object(self.dashboard.system_collector, "snapshot", return_value=system_fixture()):
            self.assertEqual(self.call("PUT", "/api/v2/integrations/system", {"enabled": True, "values": {"nodeName": "QA node"}})[0], 200)
        self.assertEqual(self.call("POST", "/api/v2/initialization/complete")[0], 409)
        self.assertEqual(self.call("PUT", "/api/v2/integrations/traffic", {"enabled": True, "values": {"quotaGb": "1000"}})[0], 200)
        self.assertEqual(self.call("POST", "/api/v2/initialization/complete")[0], 200)
        self.dashboard = DashboardService(copy.deepcopy(self.config), self.storage)
        self.server.dashboard = self.dashboard
        self.assertEqual(self.dashboard.traffic_quota_state()["bytes"], 1_000_000_000_000)
        self.assertEqual(self.call("POST", "/api/v2/auth/logout")[0], 200)
        status, session = self.call("POST", "/api/v2/auth/login", {"username": "qa-admin", "password": "Synthetic-Password-123!"})
        self.assertEqual(status, 200)
        self.assertTrue(session["setupComplete"])

    def test_invalid_json_types_return_400_without_persisting(self) -> None:
        self.start_api()
        self.initialize()
        original = self.dashboard.traffic_quota_state()
        for field in ("bytes", "periodCount", "autoReset"):
            for bad in (None, [], {}, True if field != "autoReset" else "false", 1.5):
                with self.subTest(field=field, value=bad):
                    self.assertEqual(self.call("PUT", "/api/v2/settings/traffic-limit", {field: bad})[0], 400)
        for field in ("idleTimeoutMinutes", "panelTitle", "showSetup"):
            for bad in (None, [], {}):
                self.assertEqual(self.call("PUT", "/api/v2/settings/ui", {field: bad})[0], 400)
        self.assertEqual(self.dashboard.traffic_quota_state(), original)
        self.assertEqual(self.call("GET", "/api/v2/auth/session")[0], 200)

    def test_polling_does_not_renew_idle_session_but_activity_does(self) -> None:
        self.start_api()
        self.initialize()
        token = self.cookie.split("=", 1)[1]
        with self.storage.connect() as connection:
            connection.execute("UPDATE sessions SET last_seen_at=?", (datetime.fromtimestamp(time.time() - 100, timezone.utc).isoformat(timespec="seconds"),))
        self.storage.set_setting("ui_settings", {"idleTimeoutMinutes": 2})
        before = self.storage.connect()
        with before as connection:
            original = connection.execute("SELECT last_seen_at FROM sessions").fetchone()[0]
        for _ in range(3):
            self.assertEqual(self.call("GET", "/api/v2/auth/session")[0], 200)
        with self.storage.connect() as connection:
            self.assertEqual(connection.execute("SELECT last_seen_at FROM sessions").fetchone()[0], original)
        self.assertEqual(self.call("POST", "/api/v2/auth/activity")[0], 200)
        with self.storage.connect() as connection:
            renewed = connection.execute("SELECT last_seen_at FROM sessions").fetchone()[0]
        self.assertNotEqual(renewed, original)
        with patch("castoriceui.storage.time.time", return_value=time.time() + 130):
            self.assertIsNone(self.storage.session(token, 120, touch=False))

    def ready_cache(self) -> None:
        self.dashboard.system_cache = system_fixture()
        now = datetime.now(timezone.utc).isoformat()
        self.dashboard.runtime_cache["observedAt"] = now
        for name in ("system", "runtime", "network"):
            self.dashboard._collection_result(name, observed_at=now)

    def test_stale_cache_never_becomes_live_by_getting_new_http_snapshot(self) -> None:
        self.ready_cache()
        self.dashboard.runtime_cache["observedAt"] = "2000-01-01T00:00:00+00:00"
        self.dashboard.runtime_cache["services"] = [{"id": "singbox", "status": "running"}]
        for _ in range(10):
            payload = self.dashboard.snapshot()
            self.assertEqual(payload["mode"], "stale")
            self.assertEqual(payload["services"][0]["status"], "warning")
        self.dashboard.refresh_collection_alerts()
        self.assertTrue(any(item["id"] == "collector-runtime" and item["status"] == "active" for item in self.storage.alert_history()))

    def test_collector_error_and_recovery_have_durable_alert_episode(self) -> None:
        self.ready_cache()
        with patch.object(self.dashboard.system_collector, "snapshot", side_effect=OSError("synthetic")):
            with self.assertRaises(OSError):
                self.dashboard.collect_system_snapshot()
        self.assertEqual(self.dashboard.snapshot()["mode"], "stale")
        self.dashboard.refresh_collection_alerts()
        self.assertEqual(next(item for item in self.storage.alert_history() if item["id"] == "collector-system")["status"], "active")
        with patch.object(self.dashboard.system_collector, "snapshot", return_value=system_fixture()):
            self.dashboard.collect_system_snapshot()
        self.dashboard.refresh_collection_alerts()
        self.assertEqual(next(item for item in self.storage.alert_history() if item["id"] == "collector-system")["status"], "resolved")

    def test_rate_reads_are_immutable_for_one_two_and_ten_viewers(self) -> None:
        self.ready_cache()
        raw = {"id": "flow", "protocol": "AnyTLS", "account": "qa", "sourceIp": "192.0.2.1", "uploadedBytes": 0, "downloadedBytes": 0}
        with patch("castoriceui.dashboard.time.monotonic", return_value=0):
            self.dashboard.aggregate_connections([raw])
        with patch("castoriceui.dashboard.time.monotonic", return_value=15):
            groups = self.dashboard.aggregate_connections([{**raw, "downloadedBytes": 1500}])
        self.dashboard.runtime_cache["connections"] = groups
        for viewers in (1, 2, 10):
            with ThreadPoolExecutor(max_workers=viewers) as pool:
                payloads = list(pool.map(lambda _: self.dashboard.snapshot(), range(viewers * 3)))
            self.assertTrue(all(item["connections"][0]["downloadBps"] == 100 for item in payloads))
        with patch("castoriceui.dashboard.time.monotonic", return_value=30):
            reset = self.dashboard.aggregate_connections([{**raw, "downloadedBytes": 1}])
        self.assertIsNone(reset[0]["downloadBps"])

    def test_historical_leading_and_trailing_gaps_and_open_cycle(self) -> None:
        for stamp, value in ((600, 0), (660, 100)):
            self.storage.record_sample(stamp, value, value, 0, 0, "eth0", "boot")
        usage = self.storage.traffic_usage_between(600, 3600)
        self.assertFalse(usage["coverage"]["complete"])
        self.assertTrue(usage["coverage"]["trailingGap"])
        self.assertFalse(self.storage.traffic_usage_between(0, 660)["coverage"]["complete"])
        with patch("castoriceui.storage.time.time", return_value=670):
            self.assertTrue(self.storage.traffic_usage_between(600, 3600)["coverage"]["complete"])

    def test_malformed_upstream_nested_fields_are_isolated(self) -> None:
        self.config.hysteria_api = {"url": "http://127.0.0.1:9090"}
        for malformed in ({"qa": []}, {"qa": {"tx": "wrong"}}, {"qa": {"rx": -1}}):
            def fake(url, *_args, **_kwargs):
                return malformed if url.endswith("/traffic") else {} if url.endswith("/online") else {"streams": []}
            with patch("castoriceui.collectors.http_json", side_effect=fake):
                value = hysteria_snapshot(self.config)
            self.assertFalse(value["available"])
            self.assertEqual(value["traffic"], {})
        self.config.singbox_api = {"url": "http://127.0.0.1:9091"}
        for malformed in ({"metadata": [], "upload": 0}, {"metadata": {}, "upload": "bad"}):
            with patch("castoriceui.collectors.http_json", return_value={"connections": [malformed], "uploadTotal": 0, "downloadTotal": 0}):
                self.assertFalse(singbox_snapshot(self.config)["available"])

    def test_network_target_update_immediately_removes_old_evidence(self) -> None:
        self.ready_cache()
        self.dashboard.runtime_cache["network"] = [{"name": "old", "status": "healthy", "latency": 10}]
        targets = self.dashboard.update_network_targets([{"name": "IPv6 DNS", "address": "example.com", "ipVersion": 6}], "127.0.0.1", "qa")
        self.assertEqual(targets[0]["ipVersion"], 6)
        payload = self.dashboard.snapshot()
        self.assertEqual(payload["networkTargets"][0]["name"], "IPv6 DNS")
        self.assertIsNone(payload["networkTargets"][0]["latency"])
        self.assertEqual(payload["networkTargets"][0]["probeReason"], "pending")

    def test_ipv6_default_route_and_fixed_interface(self) -> None:
        with patch("castoriceui.collectors.run", side_effect=["", "default via fe80::1 dev eth6 metric 100"]), patch("castoriceui.collectors.interface_has_counters", side_effect=lambda name: name in {"eth6", "fixed"}):
            self.assertEqual(detect_interface(""), "eth6")
            self.assertEqual(detect_interface("fixed"), "fixed")

    def test_safe_yaml_block_flow_comments_quotes_and_alias_limits(self) -> None:
        for body in ('proxies: [{name: "QA #1", type: trojan, server: example.com, port: 443, password: synthetic}]', 'proxies:\n  - name: QA\n    type: trojan\n    server: example.com # comment\n    port: 443\n    password: "synth:q"'):
            self.assertEqual(_parse_subscription(body.encode(), "application/yaml")["nodeCount"], 1)
        for body in ('proxies: &a [*a]', 'proxies: !!python/object:os.system {}', 'proxies: ' + '[' * 40 + '0' + ']' * 40, '<html>error</html>'):
            with self.assertRaises(ValueError):
                _parse_subscription(body.encode(), "application/yaml")

    def test_body_and_header_drip_obey_total_deadline(self) -> None:
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def do_GET(self):
                try:
                    if self.path == "/headers":
                        for value in b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n":
                            self.wfile.write(bytes([value])); self.wfile.flush(); time.sleep(0.01)
                    else:
                        self.send_response(200); self.send_header("Content-Length", "100"); self.end_headers()
                        for _ in range(100):
                            self.wfile.write(b"x"); self.wfile.flush(); time.sleep(0.01)
                except OSError:
                    pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path in ("/body", "/headers"):
                start = time.monotonic()
                with patch("castoriceui.security._require_public_host", return_value=["127.0.0.1"]), patch("castoriceui.security._PinnedHTTPSConnection", side_effect=lambda host, port, address, timeout: http.client.HTTPConnection(address, server.server_port, timeout=timeout)):
                    with self.assertRaises(TimeoutError):
                        _public_https_get("https://example.com" + path, {}, 1024, 0.08)
                self.assertLess(time.monotonic() - start, 0.4)
        finally:
            server.shutdown(); server.server_close(); thread.join(2)

    def test_background_parallel_requests_share_one_download_and_backoff(self) -> None:
        self.start_api()
        def image(*_args):
            time.sleep(0.03)
            return b"synthetic-image", "image/png", "https://example.com/image"
        with patch("castoriceui.api.fetch_https_image_api", side_effect=image) as fetch:
            with ThreadPoolExecutor(max_workers=8) as pool:
                values = list(pool.map(lambda _: self.server.remote_background("https://example.com/image"), range(8)))
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(len(set(values)), 1)
        with patch("castoriceui.api.fetch_https_image_api", side_effect=ValueError("synthetic")) as fetch:
            for _ in range(4):
                with self.assertRaises(ValueError):
                    self.server.remote_background("https://example.com/failure")
            self.assertEqual(fetch.call_count, 1)


if __name__ == "__main__":
    unittest.main()
