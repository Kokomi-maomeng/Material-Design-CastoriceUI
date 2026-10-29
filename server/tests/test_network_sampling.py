"""Real timestamps, bounded storage and shared global network rules."""
import copy
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import time
import unittest
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.network_sampling import NetworkSeries
from castoriceui.storage import Storage


def sample(at, latency=12.3, family=4):
    observed = datetime.fromtimestamp(at, timezone.utc).isoformat(timespec="milliseconds")
    return {"id": "qa", "name": "Test", "provider": "Test", "address": "1.1.1.1", "ipVersion": family,
            "latency": latency, "jitter": None, "loss": 100 if latency is None else 0,
            "status": "down" if latency is None else "healthy", "history": [], "observedAt": observed,
            "sampleEndedAt": observed, "measurementStatus": "measured", "complete": True,
            "sent": 1, "received": 0 if latency is None else 1}


class NetworkSamplingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.config = AppConfig(database_path=str(Path(self.folder.name) / "qa.sqlite"))
        self.storage = Storage(self.config.database_path)
        self.dashboard = DashboardService(self.config, self.storage)

    def tearDown(self):
        self.folder.cleanup()

    def test_sixty_real_points_keep_loss_and_reset_on_family_change(self):
        series = NetworkSeries()
        now = time.time()
        for index in range(61):
            target = sample(now + index, None if index == 60 else 10 + index)
            series.append(target)
        self.assertEqual(len(target["probeHistory"]), 60)
        self.assertEqual(target["probeHistory"][-1]["loss"], 100)
        self.assertIsNone(target["probeHistory"][-1]["latency"])
        self.assertAlmostEqual(target["probeHistory"][0]["capturedAt"], now + 1, places=2)
        series.append(target)
        self.assertEqual(len(target["probeHistory"]), 60)
        changed = sample(now + 62, family=6)
        series.append(changed)
        self.assertEqual(len(changed["probeHistory"]), 1)

    def test_live_ticks_do_not_write_one_history_row_per_second_or_run_optional_probes(self):
        now = time.time()
        with patch("castoriceui.dashboard.network_snapshots", side_effect=[[sample(now)], [sample(now + 1)]] ) as collect, patch("castoriceui.dashboard.layered_probe") as optional:
            self.dashboard.refresh_network()
            self.dashboard.refresh_network()
        self.assertEqual(collect.call_args.kwargs, {"count": 1})
        optional.assert_not_called()
        with self.storage.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM monitoring_samples WHERE domain='network'").fetchone()[0], 1)
        public = self.dashboard.network_targets_snapshot()[0]
        self.assertEqual(len(public["probeHistory"]), 2)
        self.assertEqual(public["sampleIntervalSeconds"], 1)
        for key in ("qualityWindow", "effectivePolicy", "thresholdOverrides", "alertConfirmed"):
            self.assertNotIn(key, public)

    def test_optional_transport_collection_is_separate_and_only_runs_when_configured(self):
        self.config.network_targets = [{"id": "qa", "name": "Test", "address": "1.1.1.1", "ipVersion": 4}]
        with patch("castoriceui.dashboard.layered_probe") as optional:
            self.dashboard.refresh_network_layers()
            optional.assert_not_called()
        self.config.network_targets[0]["tcpPort"] = 443
        with patch("castoriceui.dashboard.layered_probe", return_value={"tcp": {"configured": True, "status": "passed", "durationMs": 7.2}}) as optional:
            self.dashboard.refresh_network_layers()
            optional.assert_called_once()
        self.assertEqual(self.dashboard.layer_cache["qa"][1]["layers"]["tcp"]["durationMs"], 7.2)

    def test_a_family_change_never_reuses_the_previous_familys_history(self):
        now = time.time()
        with patch("castoriceui.dashboard.network_snapshots", side_effect=[[sample(now)], [sample(now + 1, family=6)]]):
            self.dashboard.refresh_network()
            self.assertTrue(self.dashboard.runtime_cache["network"][0]["timeHistory"])
            self.dashboard.refresh_network()
        current = self.dashboard.runtime_cache["network"][0]
        self.assertEqual(len(current["probeHistory"]), 1)
        self.assertEqual(current["timeHistory"], [])

    def test_a_target_edit_discards_in_flight_samples_before_storage_or_publication(self):
        def delayed(_config, count):
            self.dashboard._invalidate_network()
            return [sample(time.time())]
        with patch("castoriceui.dashboard.network_snapshots", side_effect=delayed):
            self.dashboard.refresh_network()
        self.assertEqual(self.dashboard.runtime_cache["network"], [])
        self.assertEqual(self.storage.monitoring_history("network"), [])

    def test_global_rules_and_targets_save_together_and_survive_a_fresh_service(self):
        target = {"name": "Test", "address": "1.1.1.1", "latencyMs": 999, "lossPercent": 99, "dnsName": "example.com"}
        self.dashboard.update_network_targets([target], "127.0.0.1", "qa", {"latencyMs": 240, "lossPercent": 8})
        saved = self.config.network_targets[0]
        self.assertNotIn("latencyMs", saved)
        self.assertEqual(saved["dnsPort"], 53)
        fresh = DashboardService(AppConfig(database_path=self.config.database_path), self.storage)
        self.assertEqual(fresh.config.alert_thresholds["latencyMs"], 240)
        self.assertEqual(fresh.config.alert_thresholds["lossPercent"], 8)
        self.assertEqual(fresh.config.alert_thresholds["trafficPercent"], 80)
        self.assertEqual(fresh.config.network_targets[0]["dnsName"], "example.com")

    def test_invalid_rules_and_storage_errors_do_not_partially_change_configuration(self):
        original = copy.deepcopy(self.config.network_targets), dict(self.config.alert_thresholds)
        target = {"name": "Test", "address": "1.1.1.1"}
        with self.assertRaises(ValueError):
            self.dashboard.update_network_targets([target], "127.0.0.1", "qa", {"latencyMs": float("nan"), "lossPercent": 8})
        with patch.object(self.storage, "set_settings", side_effect=OSError("synthetic write failure")):
            with self.assertRaises(OSError):
                self.dashboard.update_network_targets([target], "127.0.0.1", "qa", {"latencyMs": 200, "lossPercent": 8})
        self.assertEqual((self.config.network_targets, self.config.alert_thresholds), original)
        self.assertIsNone(self.storage.get_setting("network_targets", None))

    def test_stale_cache_never_presents_old_samples_as_live_measurements(self):
        self.dashboard.runtime_cache["network"] = [sample(time.time() - 30)]
        self.dashboard._collection_result("network", observed_at=sample(time.time() - 30)["observedAt"])
        public = self.dashboard.network_targets_snapshot()[0]
        self.assertEqual(public["status"], "unavailable")
        self.assertEqual(public["probeHistory"], [])
        self.assertIsNone(public["latency"])


if __name__ == "__main__":
    unittest.main()
