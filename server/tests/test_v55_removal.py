"""Upgrade cleanup must remove retired observers without altering live services."""
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from castoriceui.alert_archive import restore
from castoriceui.config import AppConfig
from castoriceui.storage import Storage
import test_v51_regressions as v51
from castoriceui.api import ApiServer
from threading import Thread


class RemovalTests(unittest.TestCase):
    def test_upgrade_removes_only_retired_rows_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "state.db")
            storage = Storage(path)
            keep = ["service-anytls", "service-hysteria2", "monitor-anytls", "network-qa", "observerish-qa", "monitor-externality-qa"]
            removed = ["monitor-external-qa-anytls", "monitor-external-qa-hysteria2", "observer-qa"]
            episodes = storage.reconcile_alerts([{"id": key, "severity": "critical", "title": key, "source": "Synthetic"} for key in keep + removed])
            storage.acknowledge(episodes[keep[0]]["episodeId"])
            storage.set_setting("external_business_incidents", {"synthetic": True})
            storage.set_setting("ui_settings", {"language": "zh"})
            storage.record_monitoring("external", "qa", {"status": "failed"})
            storage.record_monitoring("network", "observer-qa", {"loss": 0})
            storage.record_monitoring("protocol", "anytls", {"status": "running"})
            with storage.connect() as connection:
                connection.execute("CREATE TABLE probe_nonces(nonce TEXT PRIMARY KEY,captured_at INTEGER)")
                connection.execute("INSERT INTO probe_nonces VALUES('synthetic',0)")
                snapshots = {table: [tuple(row) for row in connection.execute("SELECT * FROM " + table) if row[0] not in {episodes[k]["episodeId"] for k in removed} and (table != "alert_state" or row[0] not in removed)] for table in ("alert_history", "alert_state", "alert_evidence")}
            for _ in range(2):
                storage = Storage(path)
                with storage.connect() as connection:
                    for table, before in snapshots.items():
                        self.assertEqual([tuple(row) for row in connection.execute("SELECT * FROM " + table)], before)
                    self.assertEqual(connection.execute("SELECT COUNT(*) FROM monitoring_samples WHERE domain='external' OR (domain='alert' AND (target GLOB 'monitor-external-*' OR target GLOB 'observer-*'))").fetchone()[0], 0)
                    self.assertEqual(connection.execute("SELECT COUNT(*) FROM monitoring_samples WHERE domain IN ('network','protocol')").fetchone()[0], 2)
                    self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name='probe_nonces'").fetchone())
                    self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(storage.get_setting("ui_settings", None), {"language": "zh"})
                self.assertIsNone(storage.get_setting("external_business_incidents", None))

    def test_old_configuration_is_accepted_without_restoring_probe_capabilities(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
            path.write_text(json.dumps({"node_name": "Synthetic", "external_probe_secret": "x" * 32, "external_probe_agents": ["qa"], "external_probe_protocols": {"qa": ["anytls"]}}))
            config = AppConfig.load(path)
            self.assertEqual(config.node_name, "Synthetic")
            self.assertFalse(hasattr(config, "external_probe_secret"))
            path.write_text(json.dumps({"unrecognized_option": True}))
            with self.assertRaises(ValueError):
                AppConfig.load(path)

    def test_archive_restore_cannot_resurrect_retired_alerts(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "archive.json.gz"
            def row(key):
                return {"history": {"alert_id": key, "episode_id": key, "payload_json": json.dumps({"id": key}), "started_at": "2026-01-01T00:00:00Z", "resolved_at": "2026-01-01T00:00:01Z", "acknowledged_at": "2026-01-01T00:00:02Z"}, "evidence": None}
            data = gzip.compress(json.dumps({"schema": 1, "records": [row("observer-qa"), row("monitor-external-qa-anytls"), row("service-anytls")]}).encode())
            path.write_bytes(data)
            path.with_suffix(".gz.sha256").write_text(hashlib.sha256(data).hexdigest())
            storage = Storage(str(Path(folder) / "state.db"))
            self.assertEqual(restore(storage, path), 1)
            self.assertEqual([item["id"] for item in storage.alert_history()], ["service-anytls"])


class RemovedEndpointTests(v51.IsolatedState):
    request = v51.AuthenticationRegressions.request

    def setUp(self):
        super().setUp()
        user = self.storage.create_initial_user("qa-admin", "Synthetic-Original-Password-123!")
        self.token, self.csrf, _ = self.storage.create_session(user, 3600)
        self.server = ApiServer(self.config, self.storage, self.dashboard)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(3)
        super().tearDown()

    def test_authenticated_old_probe_endpoint_is_not_found(self):
        status, body, _ = self.request("/api/v2/monitoring/probe", {}, token=self.token, csrf=self.csrf)
        self.assertEqual(status, 404)
        self.assertEqual(body, {"error": "not_found"})
