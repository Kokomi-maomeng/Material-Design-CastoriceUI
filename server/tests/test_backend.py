from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.collectors import connection_snapshots, http_json, semantic_version  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
from castoriceui.api import ApiHandler  # noqa: E402
from castoriceui.security import normalize_https_base_url, normalize_loopback_endpoint, validate_probe_target  # noqa: E402
from castoriceui.storage import Storage  # noqa: E402


class BackendTests(unittest.TestCase):
    def test_service_versions_ignore_terminal_control_sequences(self) -> None:
        self.assertEqual(semantic_version("\x1b[2JHysteria2 v2.11.0\x1b[0m", "hysteria2"), "2.11.0")
        self.assertEqual(semantic_version("sing-box version 1.13.15", "anytls"), "1.13.15")
        self.assertEqual(semantic_version("nginx version: nginx/1.26.3", "nginx"), "1.26.3")

    def test_connection_source_is_not_mislabelled_when_core_omits_it(self) -> None:
        payload = connection_snapshots(
            {"streams": [{"connection": "a", "stream": "b", "auth": "alice", "tx": 1, "rx": 2}]},
            {"connections": [{"id": "c", "metadata": {"user": "bob"}}]},
        )
        self.assertEqual(payload[0]["account"], "alice")
        self.assertEqual(payload[0]["sourceIp"], "协议核心未提供")
        self.assertIsNone(payload[0]["ipVersion"])
        self.assertEqual(payload[1]["account"], "bob")
        self.assertIsNone(payload[1]["ipVersion"])

    def test_config_merges_safe_integration_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({"database_path": str(Path(directory) / "state.db"), "integrations": {"network": {"enabled": False}}}), encoding="utf-8")
            config = AppConfig.load(path)
            self.assertFalse(config.integrations["network"]["enabled"])
            self.assertTrue(config.integrations["system"]["configured"])

    def test_storage_persists_samples_settings_and_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            storage.record_sample(100, 20, 30, 12.5, 44.0)
            storage.set_setting("traffic_limit_bytes", 123)
            storage.add_audit("test", "system", "safe detail")
            self.assertEqual(storage.samples_since(0)[0]["rx_bytes"], 20)
            self.assertEqual(storage.get_setting("traffic_limit_bytes", 0), 123)
            self.assertEqual(storage.audits()[0]["detail"], "safe detail")

    def test_integration_is_ready_only_after_authenticated_probe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            config.integrations = AppConfig.load(
                self._config_file(directory, config.database_path)
            ).integrations
            config.hysteria_api = {"url": "http://127.0.0.1:19090", "secret": "unit-test-secret"}
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            with patch("castoriceui.dashboard.http_json", return_value={}) as probe:
                result = dashboard.configure_integration("hysteria2", {"enabled": True, "values": {"endpoint": "http://127.0.0.1:19090", "secret": "must-be-ignored"}})
            self.assertTrue(result["configured"])
            probe.assert_called_once_with("http://127.0.0.1:19090/traffic", "unit-test-secret", strict=True)
            self.assertNotIn("secret", json.dumps(result))
            self.assertNotIn("secret", json.dumps(storage.get_setting("integration_overrides", {})))

    def test_non_loopback_or_failed_probe_is_not_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"secret": "unit-test-secret"}
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            with self.assertRaisesRegex(ValueError, "loopback"):
                dashboard.configure_integration("hysteria2", {"values": {"endpoint": "http://169.254.169.254/latest/meta-data"}})
            self.assertEqual(storage.get_setting("integration_overrides", {}), {})

            with self.assertRaisesRegex(ValueError, "interface"):
                dashboard.configure_integration("traffic", {"values": {"interface": "../../etc", "quotaGb": "10"}})
            with patch("castoriceui.dashboard.http_json", side_effect=ValueError("failed")):
                with self.assertRaisesRegex(ValueError, "failed"):
                    dashboard.configure_integration("hysteria2", {"values": {"endpoint": "http://127.0.0.1:19090"}})
            self.assertEqual(storage.get_setting("integration_overrides", {}), {})

    def test_legacy_sqlite_secret_is_removed_without_overwriting_server_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"url": "http://127.0.0.1:19090", "secret": "protected-config-secret"}
            storage = Storage(config.database_path)
            storage.set_setting("integration_overrides", {"hysteria2": {"enabled": True, "configured": True, "values": {"endpoint": "http://127.0.0.1:19090", "secret": "legacy-plaintext"}}})
            DashboardService(config, storage)
            self.assertNotIn("secret", json.dumps(storage.get_setting("integration_overrides", {})))
            self.assertEqual(config.hysteria_api["secret"], "protected-config-secret")

    def test_legacy_non_loopback_endpoint_is_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            storage = Storage(config.database_path)
            storage.set_setting("integration_overrides", {"hysteria2": {"configured": True, "values": {"endpoint": "http://169.254.169.254/latest"}}})
            dashboard = DashboardService(config, storage)
            saved = storage.get_setting("integration_overrides", {})["hysteria2"]
            self.assertFalse(saved["configured"])
            self.assertNotIn("endpoint", saved["values"])
            self.assertNotIn("169.254.169.254", json.dumps(dashboard.config.hysteria_api))

    def test_url_and_probe_target_validation(self) -> None:
        self.assertEqual(normalize_loopback_endpoint("http://127.0.0.1:19090/"), "http://127.0.0.1:19090")
        self.assertEqual(normalize_loopback_endpoint("http://[::1]:19090"), "http://[::1]:19090")
        self.assertEqual(normalize_https_base_url("https://panel.example.com/subscription/"), "https://panel.example.com/subscription")
        self.assertEqual(validate_probe_target("2606:4700:4700::1111")[1], 6)
        with self.assertRaises(ValueError):
            normalize_loopback_endpoint("http://example.com:19090")
        with self.assertRaises(ValueError):
            normalize_https_base_url("http://panel.example.com/subscription")
        with self.assertRaises(ValueError):
            validate_probe_target("-f")

    def test_mutations_require_custom_request_guard(self) -> None:
        handler = object.__new__(ApiHandler)
        handler.headers = {}
        handler.send_json = MagicMock()
        self.assertFalse(handler.require_mutation_header())
        handler.send_json.assert_called_once()
        handler.headers = {"X-CastoriceUI-Request": "1", "X-Real-IP": "203.0.113.42"}
        handler.client_address = ("127.0.0.1", 12345)
        self.assertTrue(handler.require_mutation_header())
        self.assertEqual(handler.source_ip(), "203.0.113.42")

    def test_strict_probe_authenticates_and_does_not_follow_redirects(self) -> None:
        class ProbeHandler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:
                if self.path == "/traffic" and self.headers.get("Authorization") == "unit-test-secret":
                    body = b"{}"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://169.254.169.254/latest/meta-data")
                    self.end_headers()
                    return
                self.send_response(401)
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            self.assertEqual(http_json(base + "/traffic", "unit-test-secret", strict=True), {})
            with self.assertRaisesRegex(ValueError, "validation failed"):
                http_json(base + "/redirect", strict=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_live_payload_masks_addresses_and_subscription_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            config.redact_live_data = True
            config.subscriptions = [{"id": "sub-1", "account": "alice", "url": "https://example.test/subscription/private-token", "enabled": True}]
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            public = dashboard.public_subscriptions()
            self.assertNotIn("private-token", json.dumps(public))
            self.assertNotEqual(public[0]["account"], "alice")
            self.assertEqual(dashboard.subscription_url("sub-1"), "https://example.test/subscription/private-token")
            self.assertEqual(dashboard._mask_ip("203.0.113.42"), "203.0.113.*")

    def test_live_payload_can_show_authenticated_operator_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"), redact_live_data=False)
            config.subscriptions = [{"id": "sub-1", "account": "alice", "url": "https://example.test/subscription/private-token", "enabled": True}]
            dashboard = DashboardService(config, Storage(config.database_path))
            public = dashboard.public_subscriptions()
            self.assertEqual(public[0]["account"], "alice")
            self.assertNotIn("url", public[0])

    @staticmethod
    def _config_file(directory: str, database: str) -> str:
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"database_path": database}), encoding="utf-8")
        return str(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
