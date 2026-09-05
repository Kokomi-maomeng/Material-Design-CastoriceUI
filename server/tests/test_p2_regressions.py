from __future__ import annotations

import copy
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch


SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from castoriceui.api import ApiServer  # noqa: E402
from castoriceui.collectors import (  # noqa: E402
    certificate_info,
    http_json,
    ping_target,
    protocol_requested,
)
from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
from castoriceui.protocol_probe import config_paths, inbound_records  # noqa: E402
from castoriceui.security import probe_subscription_url  # noqa: E402
from castoriceui.storage import Storage  # noqa: E402


class P2RegressionTests(unittest.TestCase):
    def service(self, directory: str, **config_values: object) -> tuple[DashboardService, Storage]:
        storage = Storage(str(Path(directory) / "state.db"))
        config = AppConfig(database_path=storage.path, **config_values)
        return DashboardService(config, storage), storage

    def test_f07_network_wizard_and_structured_editor_share_restart_safe_storage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, storage = self.service(directory)
            dashboard.configure_integration(
                "network",
                {"values": {"targets": "Second,2001:4860:4860::8888\nFirst,1.1.1.1"}},
                actor="operator",
            )
            restarted = DashboardService(AppConfig(database_path=storage.path), storage)
            self.assertEqual(
                [(item["name"], item["address"], item["order"]) for item in restarted.config.network_targets],
                [("Second", "2001:4860:4860::8888", 1), ("First", "1.1.1.1", 2)],
            )
            restarted.update_network_targets(
                [
                    {"name": "Renamed", "address": "8.8.8.8", "order": 2},
                    {"name": "First", "address": "1.1.1.1", "order": 1},
                ],
                "127.0.0.1",
                "operator",
            )
            final = DashboardService(AppConfig(database_path=storage.path), storage)
            self.assertEqual([item["name"] for item in final.config.network_targets], ["First", "Renamed"])

    def test_f08_runtime_management_requests_never_follow_redirects_or_forward_auth(self) -> None:
        received: list[str | None] = []

        class Destination(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:
                received.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

        destination = ThreadingHTTPServer(("127.0.0.1", 0), Destination)
        destination_thread = threading.Thread(target=destination.serve_forever, daemon=True)
        destination_thread.start()

        for redirect_status in (301, 302, 307, 308):
            class Redirect(BaseHTTPRequestHandler):
                def log_message(self, _format: str, *_args: object) -> None:
                    return

                def do_GET(self) -> None:
                    self.send_response(redirect_status)
                    self.send_header("Location", f"http://127.0.0.1:{destination.server_port}/capture")
                    self.end_headers()

            redirect = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
            thread = threading.Thread(target=redirect.serve_forever, daemon=True)
            thread.start()
            try:
                self.assertIsNone(http_json(f"http://127.0.0.1:{redirect.server_port}/redirect", "unit-secret"))
            finally:
                redirect.shutdown()
                redirect.server_close()
                thread.join(timeout=2)
        destination.shutdown()
        destination.server_close()
        destination_thread.join(timeout=2)
        self.assertEqual(received, [])

    def test_f10_single_account_keeps_protocol_usage_separate_from_host_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, _ = self.service(directory)
            accounts = [{"id": "primary", "name": "primary", "trafficIdentities": {"hysteria2": ["user"]}}]
            result = dashboard.account_metrics(accounts, {"traffic": {"user": {"tx": 90, "rx": 10}}, "online": {"user": 1}}, 1_000_000)
            self.assertEqual(result[0]["usedBytes"], 100)
            self.assertEqual(result[0]["usageSource"], "protocolCounter")

    def test_f11_account_status_separates_registration_expiry_and_runtime_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, _ = self.service(directory)
            account = {"id": "expired", "name": "Expired", "expiresAt": "2000-01-01", "trafficIdentities": {"hysteria2": ["user"]}}
            result = dashboard.account_metrics([account], {"available": True, "traffic": {}, "online": {}}, 0)[0]
            self.assertEqual(result["configuredStatus"], "unknown")
            self.assertEqual(result["expiryStatus"], "expired")
            self.assertEqual(result["coreEvidence"], "notObserved")
            self.assertNotEqual(result["status"], "active")

    def test_f12_certificate_states_and_alerts_are_truthful(self) -> None:
        decoded = {"notAfter": (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%b %d %H:%M:%S %Y GMT")}
        with tempfile.NamedTemporaryFile() as certificate, patch("castoriceui.collectors.ssl._ssl._test_decode_cert", return_value=decoded):
            result = certificate_info(certificate.name)
        self.assertEqual(result["state"], "expired")
        self.assertNotIn("automatic renewal", result["detail"])
        with tempfile.TemporaryDirectory() as directory:
            dashboard, _ = self.service(directory)
            alerts = dashboard.alerts(
                {"trafficUsedBytes": 0, "trafficLimitBytes": 1000},
                [{"id": "certificate", "name": "TLS certificate", "status": "warning", "certificateState": "expired", "detail": "expired"}],
                [],
            )
        self.assertEqual(alerts[0]["id"], "certificate-expired")

    def test_f13_probe_uses_transport_and_marks_unknown_transport_unverifiable(self) -> None:
        quic = {"inbounds": [{"type": "vmess", "tag": "vmess-quic", "listen_port": 443, "transport": {"type": "quic"}}]}
        self.assertTrue(inbound_records([quic], {("udp", 443)})[0]["listening"])
        unknown = {"inbounds": [{"type": "trojan", "tag": "future", "listen_port": 8443, "transport": {"type": "future-transport"}}]}
        record = inbound_records([unknown], {("tcp", 8443)})[0]
        self.assertFalse(record["verificationSupported"])
        for transport in ("tcp", "ws", "grpc", "http", "httpupgrade"):
            payload = {"inbounds": [{"type": "vless", "tag": transport, "listen_port": 9000, "transport": {"type": transport}}]}
            self.assertTrue(inbound_records([payload], {("tcp", 9000)})[0]["listening"], transport)
        for network, listeners in (("tcp", {("tcp", 8388)}), ("udp", {("udp", 8388)}), ("", {("tcp", 8388), ("udp", 8388)})):
            payload = {"inbounds": [{"type": "shadowsocks", "tag": f"ss-{network or 'both'}", "listen_port": 8388, "network": network}]}
            self.assertTrue(inbound_records([payload], listeners)[0]["listening"], network or "both")

    def test_f14_untouched_optional_example_protocols_are_not_requested(self) -> None:
        example = json.loads((SERVER_ROOT / "config.example.json").read_text(encoding="utf-8"))
        config = AppConfig(**example)
        self.assertFalse(config.subscription_base_url)
        self.assertFalse(config.hysteria_api.get("url"))
        self.assertFalse(config.singbox_api.get("url"))
        self.assertTrue(all(not protocol_requested(config, protocol) for protocol in ("hysteria2", "anytls", "vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic")))

    def test_f15_snapshot_reads_cache_without_waiting_for_slow_upstreams(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, _ = self.service(directory)
            system = {
                "nodeName": "node", "cpuPercent": 0, "cpuCores": 1, "memoryPercent": 0,
                "memoryUsedBytes": 1, "memoryTotalBytes": 2, "diskPercent": 0,
                "diskUsedBytes": 1, "diskTotalBytes": 2, "load": [0, 0, 0], "uptimeSeconds": 1,
                "trafficUsedBytes": 0, "trafficLimitBytes": 1000, "trafficCycleStart": "2026-01-01T00:00:00Z",
                "trafficBaselineBytes": 0, "trafficCountMode": "sum", "trafficQuotaUnit": "GB",
                "downloadBps": 0, "uploadBps": 0, "interface": "eth0", "kernel": "test",
                "databaseBytes": 0, "databaseWritable": True,
            }
            dashboard.system_cache = system
            with patch("castoriceui.dashboard.hysteria_snapshot", side_effect=lambda _config: time.sleep(1)):
                started = time.monotonic()
                payload = dashboard.snapshot()
            self.assertLess(time.monotonic() - started, 0.2)
            self.assertEqual(payload["mode"], "live")

    def test_f16_background_monitor_records_failure_and_recovery_without_browser(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, storage = self.service(directory)
            system = {"trafficUsedBytes": 0, "trafficLimitBytes": 1000}
            dashboard.evaluate_monitoring(system, [{"id": "nginx", "name": "Nginx", "status": "stopped", "detail": "offline"}], [], [])
            dashboard.evaluate_monitoring(system, [], [], [])
            history = storage.alert_history()
            event = next(item for item in history if item["alertId"] == "service-nginx")
            self.assertIsNotNone(event["resolvedAt"])
            self.assertTrue(event["startedAt"] < event["resolvedAt"] or event["startedAt"] == event["resolvedAt"])

    def test_f16_existing_active_episode_is_backfilled_before_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            with storage.connect() as connection:
                connection.execute(
                    "INSERT INTO alert_state(alert_id,episode_id,active,started_at,acknowledged_at) VALUES(?,?,?,?,NULL)",
                    ("service-nginx", "legacy-episode", 1, "2026-01-01T00:00:00+00:00"),
                )
            storage.reconcile_alerts([{"id": "service-nginx", "title": "Nginx stopped"}])
            self.assertEqual(storage.alert_history()[0]["episodeId"], "legacy-episode")
            storage.reconcile_alerts([])
            self.assertEqual(storage.alert_history()[0]["status"], "resolved")

    def test_f17_probe_unavailable_and_no_reply_never_report_zero_latency(self) -> None:
        target = {"id": "v4", "name": "v4", "address": "192.0.2.1", "ipVersion": 4}
        with patch("castoriceui.collectors.shutil.which", return_value=None):
            unavailable = ping_target(target)
        self.assertEqual(unavailable["status"], "unavailable")
        self.assertIsNone(unavailable["latency"])
        completed = MagicMock(returncode=1, stdout="8 packets transmitted, 0 received, 100% packet loss", stderr="")
        with patch("castoriceui.collectors.shutil.which", return_value="/usr/bin/ping"), patch("castoriceui.collectors.subprocess.run", return_value=completed):
            down = ping_target(target)
        self.assertEqual(down["status"], "down")
        self.assertIsNone(down["latency"])
        self.assertEqual(down["probeReason"], "noReply")
        completed_v6 = MagicMock(returncode=0, stdout="64 bytes: time=12.5 ms\n1 packets transmitted, 1 received, 0% packet loss", stderr="")
        with patch("castoriceui.collectors.shutil.which", return_value="/usr/bin/ping"), patch("castoriceui.collectors.subprocess.run", return_value=completed_v6) as invoked:
            measured_v6 = ping_target({**target, "address": "2001:db8::1", "ipVersion": 6})
        self.assertEqual(measured_v6["latency"], 12.5)
        self.assertIn("-6", invoked.call_args.args[0])

    def test_f19_ipv6_server_and_inline_directory_argument(self) -> None:
        if not socket.has_ipv6:
            self.skipTest("IPv6 is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"), secure_cookies=False, listen_host="::1", listen_port=0)
            storage = Storage(config.database_path)
            server = ApiServer(config, storage, MagicMock())
            try:
                self.assertEqual(server.address_family, socket.AF_INET6)
            finally:
                server.server_close()
        self.assertEqual(config_paths(["sing-box", "run", "--directory=/opt/core", "-c=config.json"], Path("/")), [Path("/opt/core/config.json")])

    def test_f15_cached_dashboard_survives_concurrent_request_stress(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, _ = self.service(directory)
            dashboard.system_cache = {
                "nodeName": "node", "cpuPercent": 0, "cpuCores": 1, "memoryPercent": 0,
                "memoryUsedBytes": 1, "memoryTotalBytes": 2, "diskPercent": 0, "diskUsedBytes": 1,
                "diskTotalBytes": 2, "load": [0, 0, 0], "uptimeSeconds": 1, "trafficUsedBytes": 0,
                "trafficLimitBytes": 1000, "trafficCycleStart": "2026-01-01T00:00:00Z", "trafficBaselineBytes": 0,
                "trafficCountMode": "sum", "trafficQuotaUnit": "GB", "downloadBps": 0, "uploadBps": 0,
                "interface": "eth0", "kernel": "test", "databaseBytes": 0, "databaseWritable": True,
            }
            with ThreadPoolExecutor(max_workers=32) as pool:
                payloads = list(pool.map(lambda _index: dashboard.snapshot(), range(128)))
            self.assertEqual(len(payloads), 128)
            self.assertTrue(all(item["mode"] == "live" for item in payloads))

    def test_f22_integration_audit_uses_authenticated_actor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dashboard, storage = self.service(directory)
            dashboard.configure_integration("system", {"values": {"nodeName": "node"}}, source_ip="127.0.0.1", actor="audit-operator")
            row = storage.audit_page()["items"][0]
            self.assertEqual(row["actor"], "audit-operator")

    def test_f23_counter_reset_counts_known_post_reset_value_and_reports_gap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            for captured_at, value in ((100, 100), (200, 200), (300, 20), (400, 30)):
                storage.record_sample(captured_at, value, value, 0, 0, "eth0", "boot")
            usage = storage.traffic_usage_between(0, 500)
            self.assertEqual(usage["usedBytes"], 260)
            self.assertEqual(usage["coverage"]["resetCount"], 1)
            self.assertGreaterEqual(usage["coverage"]["gapCount"], 1)

    def test_f29_subscription_probe_rejects_html_empty_and_invalid_nodes(self) -> None:
        headers = MagicMock()
        headers.get.return_value = None
        headers.get_content_type.return_value = "text/html"
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, b"<html>login</html>")):
            with self.assertRaisesRegex(ValueError, "HTML"):
                probe_subscription_url("https://example.test/sub")
        headers.get_content_type.return_value = "application/json"
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, b'{"outbounds":[]}')):
            with self.assertRaisesRegex(ValueError, "node"):
                probe_subscription_url("https://example.test/sub")
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, b'{"outbounds":[{"type":"vless","server":"example.com","server_port":443,"uuid":"test-id"}]}')):
            result = probe_subscription_url("https://example.test/sub")
        self.assertEqual(result["format"], "sing-box-json")
        self.assertEqual(result["nodeCount"], 1)


if __name__ == "__main__":
    unittest.main()
