"""Alert noise, durable logging and combined local-date filtering regressions."""
import json
from pathlib import Path
import tempfile
import sys
import time
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.alert_policy import AlertPolicy, level, present
from castoriceui.alert_archive import archive
from castoriceui.storage import Storage
from castoriceui.external_probe import service_evidence
from castoriceui.config import AppConfig


def event(key="network-qa", severity="info", loss=12.5):
    return {"id": key, "title": "Synthetic event", "description": "Synthetic", "severity": severity, "evidence": {"loss": loss, "latency": 10}}


class AlertNoiseTests(unittest.TestCase):
    def test_levels_distinguish_actual_outage_quality_and_missing_samples(self):
        self.assertEqual(level(event("service-anytls", "critical")), "critical")
        for key in ("collector-system", "integration-subscriptions", "network-probe-qa", "certificate-evidence"):
            self.assertEqual(level(event(key, "warning")), "info")
        self.assertEqual(level(event(loss=12.5)), "info")
        self.assertEqual(level(event(loss=30)), "warning")
        self.assertEqual(level({**event(), "evidence": {"loss": 0, "latency": 350, "effectivePolicy": None}}), "warning")

    def test_short_gaps_are_logged_without_an_alert_and_watchdog_keeps_the_window(self):
        policy = AlertPolicy()
        collector = event("collector-system", "warning")
        self.assertEqual(policy.apply([collector], [], now=0), [])
        self.assertEqual(policy.apply([collector], [], now=299), [])
        self.assertEqual(len(policy.apply([collector], [], now=300)), 1)
        self.assertEqual(policy.apply([], [], now=301), [])
        self.assertEqual(policy.apply([collector], [], now=302), [])
        network = event()
        self.assertEqual(policy.apply([network], [], now=400), [])
        policy.apply([], [], now=405, prune=False)
        self.assertEqual(len(policy.apply([network], [], now=580)), 1)

    def test_one_missing_device_produces_one_info_reminder_for_two_protocols(self):
        policy = AlertPolicy()
        records = [{**event("monitor-external-qa-" + protocol, "warning"), "reason": "external_observer_unavailable", "evidence": {"agentId": "qa", "protocol": protocol}} for protocol in ("anytls", "hysteria2")]
        self.assertEqual(policy.apply(records, [], now=0), [])
        result = policy.apply(records, [], now=600)
        self.assertEqual([(item["id"], item["severity"]) for item in result], [("observer-qa", "info")])
        self.assertNotIn("evidence", result[0]["titleEn"])
        failure = {**records[0], "reason": "external_business_failure", "evidence": {"agentId": "qa", "protocol": "anytls", "result": {"failedStage": "authentication"}}}
        policy.apply([failure], [], now=601)
        result = policy.apply([failure], [], now=901)
        self.assertEqual(result[0]["severity"], "info")
        self.assertIn("authentication", result[0]["titleEn"])

    def test_external_warning_requires_two_current_failing_devices(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "state.db"))
            config = AppConfig(external_probe_secret="x" * 32, external_probe_agents=["qa-one", "qa-two"], external_probe_protocols={"qa-one": ["anytls"], "qa-two": ["anytls"]})
            now = int(time.time())
            for agent in config.external_probe_agents:
                for at in (now - 2, now - 1):
                    storage.record_monitoring("external", agent, {"agentId": agent, "observedAt": at, "agentHealthy": True, "protocols": {"anytls": {"status": "failed", "failedStage": "forwarding"}}}, now=at)
            services = service_evidence(config, storage, set(), now=now)
            self.assertEqual([item["evidence"]["failedObserverCount"] for item in services], [2, 2])
            self.assertTrue(all(level({"id": "monitor-" + item["id"], "reason": item["stateReason"], "evidence": item["evidence"]}) == "warning" for item in services))
            for at in (now, now + 1):
                storage.record_monitoring("external", "qa-two", {"agentId": "qa-two", "observedAt": at, "agentHealthy": True, "protocols": {"anytls": {"status": "passed"}}}, now=at)
            services = service_evidence(config, storage, set(), now=now + 1)
            self.assertEqual(services[0]["evidence"]["failedObserverCount"], 1)
            self.assertEqual(level({"id": "monitor-" + services[0]["id"], "reason": services[0]["stateReason"], "evidence": services[0]["evidence"]}), "info")

    def test_duplicate_collector_and_integration_do_not_create_two_notices(self):
        policy = AlertPolicy()
        candidates = [event("collector-system"), event("integration-system"), event("integration-traffic")]
        policy.apply(candidates, [], now=0)
        result = policy.apply(candidates, [], now=300)
        self.assertEqual([item["id"] for item in result], ["collector-system"])

    def test_missing_recovery_check_does_not_close_or_downgrade_a_real_outage(self):
        item = {**event("service-anytls", "warning"), "reason": "recovery_unconfirmed"}
        result = AlertPolicy().apply([item], [item], now=0)
        self.assertEqual(result[0]["severity"], "critical")
        self.assertIn("recovery check", result[0]["titleEn"])


class AlertLogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Storage(str(Path(self.temp.name) / "state.db"))

    def tearDown(self):
        self.temp.cleanup()

    def test_flapping_pending_reminders_merge_and_acknowledged_faults_notify_again(self):
        first = self.storage.reconcile_alerts([event()])["network-qa"]["episodeId"]
        for _ in range(25):
            self.storage.reconcile_alerts([])
            self.assertEqual(self.storage.reconcile_alerts([event()])["network-qa"]["episodeId"], first)
        self.assertEqual(self.storage.alert_page()["total"], 1)
        with self.storage.connect() as connection:
            payload = json.loads(connection.execute("SELECT payload_json FROM alert_history").fetchone()[0])
            self.assertEqual(payload["repeatCount"], 26)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM alert_evidence").fetchone()[0], 1)
        self.storage.acknowledge(first)
        self.storage.reconcile_alerts([])
        second = self.storage.reconcile_alerts([event()])["network-qa"]["episodeId"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.storage.alert_summary()["pending"], 1)
        self.assertEqual({p.name for p in Path(self.temp.name).iterdir()}, {"state.db"})

    def test_filters_are_intersections_and_local_end_day_is_inclusive(self):
        rows = [
            ("before", "2026-10-14T15:59:59Z", None, None),
            ("start", "2026-10-15T00:00:00+08:00", None, None),
            ("end", "2026-10-15T15:59:59Z", "2026-10-15T16:00:00Z", None),
            ("after", "2026-10-15T16:00:00Z", None, None),
            ("ack", "2026-10-15T05:00:00Z", None, "2026-10-15T06:00:00Z"),
        ]
        with self.storage.connect() as connection:
            for episode, started, resolved, acknowledged in rows:
                connection.execute("INSERT INTO alert_history VALUES(?,?,?,?,?,?)", (episode, "network-qa", json.dumps(event()), started, resolved, acknowledged))
        options = {"start": "2026-10-14T16:00:00Z", "end": "2026-10-15T16:00:00Z", "severity": "info"}
        self.assertEqual(self.storage.alert_page(**options)["total"], 3)
        self.assertEqual(self.storage.alert_page(pending=True, **options)["total"], 2)
        self.assertEqual(self.storage.alert_page(pending=True, status="active", **options)["total"], 1)
        self.assertEqual(self.storage.alert_page(status="recovered", **options)["items"][0]["episodeId"], "end")
        self.assertEqual(self.storage.alert_page(severity="critical")["total"], 0)
        for options in ({"start": "1970-01-22T00:00:00Z"}, {"start": "2026-10-15"}, {"severity": "warning,info"}, {"start": "2026-10-16T00:00:00Z", "end": "2026-10-15T00:00:00Z"}):
            with self.assertRaises(ValueError):
                self.storage.alert_page(**options)

    def test_severity_escalation_after_acknowledgement_creates_a_new_pending_incident(self):
        quota = lambda used: {"id": "traffic-threshold", "severity": "info" if used < 90 else "critical", "evidence": {"usedPercent": used}}
        first = self.storage.reconcile_alerts([quota(80)])["traffic-threshold"]["episodeId"]
        self.storage.acknowledge(first)
        second = self.storage.reconcile_alerts([quota(100)])["traffic-threshold"]["episodeId"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.storage.alert_summary()["critical"], 1)
        self.assertEqual(self.storage.alert_page(pending=True)["items"][0]["episodeId"], second)

    def test_historical_presentation_summary_filter_and_raw_records_agree(self):
        item = event("collector-system", "warning")
        episode = self.storage.reconcile_alerts([item])[item["id"]]["episodeId"]
        page = self.storage.alert_page(severity="info")
        self.assertEqual(page["summary"]["info"], 1)
        self.assertEqual(page["summary"]["warning"], 0)
        self.assertEqual(page["items"][0]["episodeId"], episode)
        self.assertEqual(page["logLocation"]["database"], self.storage.path)
        with self.storage.connect() as connection:
            self.assertEqual(json.loads(connection.execute("SELECT payload_json FROM alert_history").fetchone()[0]), item)

    def test_samples_are_bounded_and_stable_protocol_snapshots_are_coalesced(self):
        now = int(time.time())
        for index in range(10):
            self.assertTrue(self.storage.record_monitoring("protocol", "singbox", {"pid": 1, "sampledAt": now + index}, now=now + index))
        with self.storage.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM monitoring_samples").fetchone()[0], 1)
            payload = json.dumps({"value": "x" * 32000})
            connection.executemany("INSERT INTO monitoring_samples(captured_at,domain,target,payload_json) VALUES(?,?,?,?)", [(now, "network", "qa", payload)] * 1100)
        for _ in range(100):
            self.storage.record_monitoring("network", "qa", {"loss": 1}, now=now)
        with self.storage.connect() as connection:
            self.assertLessEqual(connection.execute("SELECT SUM(length(CAST(payload_json AS BLOB))) FROM monitoring_samples").fetchone()[0], 32 * 1024 * 1024)
        self.storage.record_monitoring("resource", "backend", {"memoryBytes": 123, "tcpCounters": "x" * 20000})
        self.assertNotIn("tcpCounters", self.storage.monitoring_history("resource")[0])

    def test_automatic_archive_waits_for_a_batch_and_protects_pending_events(self):
        for index in range(3):
            episode = self.storage.reconcile_alerts([event("qa-" + str(index))])["qa-" + str(index)]["episodeId"]
            self.storage.acknowledge(episode)
        self.storage.reconcile_alerts([])
        with self.storage.connect() as connection:
            connection.execute("UPDATE alert_history SET resolved_at='2010-01-01T00:00:00Z'")
        folder = Path(self.temp.name) / "archives"
        self.assertEqual(archive(self.storage, folder, minimum_batch=100)["archived"], 0)
        self.assertFalse(folder.exists())
        self.assertEqual(archive(self.storage, folder)["archived"], 3)
        self.assertEqual(len(list(folder.iterdir())), 2)


if __name__ == "__main__":
    unittest.main()
