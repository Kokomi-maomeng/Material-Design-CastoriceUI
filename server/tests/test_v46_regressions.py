"""Durable pending alerts, per-episode acknowledgement and full pagination."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_v45_regressions as v45
from castoriceui.storage import Storage


def item(alert_id="condition"):
    return {"id": alert_id, "severity": "warning", "title": "Synthetic alert", "description": "QA condition", "source": "QA", "time": "now"}


class AlertStorageRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.storage = Storage(self.path, audit_retention_days=7)

    def tearDown(self):
        self.temp.cleanup()

    def test_recovery_restart_acknowledgement_and_recurrence_are_separate(self):
        first = self.storage.reconcile_alerts([item()])["condition"]["episodeId"]
        self.storage.reconcile_alerts([])
        restarted = Storage(self.path, audit_retention_days=7)
        pending = restarted.alert_page(pending=True)
        self.assertEqual(pending["total"], 1)
        self.assertEqual(pending["items"][0]["status"], "resolved")
        second = restarted.reconcile_alerts([item()])["condition"]["episodeId"]
        self.assertNotEqual(first, second)
        self.assertTrue(restarted.acknowledge(first))
        self.assertEqual(restarted.alert_page(pending=True)["items"][0]["episodeId"], second)
        self.assertEqual(restarted.alert_summary()["pending"], 1)
        self.assertTrue(restarted.acknowledge(second))
        timestamp = restarted.alert_page()["items"][0]["acknowledgedAt"]
        self.assertTrue(restarted.acknowledge(second))
        self.assertEqual(restarted.alert_page()["items"][0]["acknowledgedAt"], timestamp)
        self.assertEqual(restarted.alert_page(pending=True)["total"], 0)
        self.assertEqual(restarted.alert_page()["total"], 2)

    def test_full_history_and_summary_exceed_200_and_bulk_confirmation_exceeds_one_page(self):
        self.storage.reconcile_alerts([item(f"condition-{i}") for i in range(265)])
        self.storage.reconcile_alerts([])
        summary = self.storage.alert_summary()
        self.assertEqual(summary, {"pending": 265, "critical": 0, "warning": 265, "info": 0})
        self.assertEqual(len(self.storage.alert_page(page_size=30)["items"]), 30)
        episodes = [event["episodeId"] for page in range(1, 7) for event in self.storage.alert_page(page, 50)["items"]]
        self.assertEqual(len(episodes), 265)
        self.assertEqual(len(set(episodes)), 265)
        self.assertEqual(self.storage.acknowledge_all(), 265)
        self.assertEqual(self.storage.alert_summary()["pending"], 0)
        self.assertEqual(self.storage.alert_page(pending=True)["total"], 0)
        self.assertEqual(self.storage.alert_page()["total"], 265)
        self.assertEqual(self.storage.acknowledge_all(), 0)
        self.storage.reconcile_alerts([item("condition-0")])
        self.assertEqual(self.storage.alert_summary()["pending"], 1)

    def test_old_recovered_episodes_are_not_pruned(self):
        episode = self.storage.reconcile_alerts([item()])["condition"]["episodeId"]
        self.storage.reconcile_alerts([])
        with self.storage.connect() as db:
            db.execute("UPDATE alert_history SET started_at='2010-01-01T00:00:00+00:00', resolved_at='2010-01-01T01:00:00+00:00'")
        self.storage.reconcile_alerts([])
        self.assertEqual(self.storage.alert_page(pending=True)["total"], 1)
        self.storage.acknowledge(episode)
        self.storage.reconcile_alerts([])
        self.assertEqual(self.storage.alert_page()["total"], 1)

    def test_watchdog_does_not_resolve_active_episodes_beyond_the_history_cache(self):
        self.storage.reconcile_alerts([item(f"condition-{i}") for i in range(240)])
        dashboard = v45.DashboardService(v45.AppConfig(database_path=self.path), self.storage)
        with patch.object(dashboard, "collection_alerts", return_value=[]):
            dashboard.refresh_collection_alerts()
        self.assertEqual(len(self.storage.active_alerts()), 240)


class AlertApiRegressions(unittest.TestCase):
    setUp = v45.AuditRegressions.setUp
    tearDown = v45.AuditRegressions.tearDown
    start_api = v45.AuditRegressions.start_api
    initialize = v45.AuditRegressions.initialize
    call = v45.AuditRegressions.call

    def test_authenticated_pagination_recovered_confirmation_and_csrf(self):
        self.start_api()
        self.assertEqual(self.call("GET", "/api/v2/alerts")[0], 401)
        self.initialize()
        episode = self.storage.reconcile_alerts([item()])["condition"]["episodeId"]
        self.storage.reconcile_alerts([])
        status, page = self.call("GET", "/api/v2/alerts?filter=pending&pageSize=50")
        self.assertEqual(status, 200)
        self.assertEqual(page["total"], 1)
        for query in ("page=0", "pageSize=200", "filter=active", "page=bad"):
            self.assertEqual(self.call("GET", "/api/v2/alerts?" + query)[0], 400)
        original = self.csrf
        self.csrf = "wrong"
        self.assertEqual(self.call("POST", f"/api/v2/alerts/{episode}/ack")[0], 403)
        self.assertEqual(self.storage.alert_summary()["pending"], 1)
        self.csrf = original
        self.assertEqual(self.call("POST", f"/api/v2/alerts/{episode}/ack")[0], 200)
        self.assertEqual(self.call("GET", "/api/v2/alerts?filter=pending")[1]["total"], 0)
        self.assertEqual(self.call("GET", "/api/v2/alerts?filter=all")[1]["total"], 1)
        self.storage.reconcile_alerts([item("second")])
        status, result = self.call("POST", "/api/v2/alerts/ack-all")
        self.assertEqual((status, result["count"]), (200, 1))
        self.assertEqual(self.storage.alert_summary()["pending"], 0)
        self.assertEqual(self.call("POST", "/api/v2/alerts/does-not-exist/ack")[0], 404)
