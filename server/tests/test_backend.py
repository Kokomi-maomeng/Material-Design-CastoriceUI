from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.collectors import connection_snapshots, semantic_version  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
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

    def test_integration_secrets_are_not_returned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            config.integrations = AppConfig.load(
                self._config_file(directory, config.database_path)
            ).integrations
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            result = dashboard.configure_integration("hysteria2", {"enabled": True, "values": {"endpoint": "http://127.0.0.1:19090", "secret": "unit-test-secret"}})
            self.assertTrue(result["configured"])
            self.assertNotIn("secret", json.dumps(result))

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
