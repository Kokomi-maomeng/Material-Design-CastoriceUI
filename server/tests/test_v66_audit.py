"""Regressions for the v6.5 audit reproductions using isolated state and HTTP."""
import contextlib
import http.client
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.api import ApiServer
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.dns_wire import verified_a_response
from castoriceui.security import _parse_subscription, _require_public_host, normalize_loopback_endpoint
from castoriceui.storage import Storage
from castoriceui.traffic_quota import traffic_quota_period


class HttpAuditRegressions(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        self.config = AppConfig(listen_port=0, database_path=str(Path(temp) / "state.db"))
        self.storage = Storage(self.config.database_path, 3650)
        self.storage.create_initial_user("qa-admin", "Synthetic-Password-123!")
        self.dashboard = DashboardService(self.config, self.storage)
        self.server = ApiServer(self.config, self.storage, self.dashboard)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.worker.join, 5)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        session, csrf, _ = self.storage.create_session(1, 3600)
        self.guard = {"Content-Type": "application/json", "X-CastoriceUI-Request": "1", "X-CSRF-Token": csrf,
                      "Cookie": "castorice_session=" + session}

    def call(self, path, method="POST", body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            if isinstance(body, dict):
                body = json.dumps(body)
            connection.request(method, path, body, self.guard if headers is None else headers)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), response.getheader("Set-Cookie")
        finally:
            connection.close()

    def test_login_rejects_cross_site_form_and_deep_json_accepts_forwarded_origin(self):
        path = "/api/v2/auth/login"
        body = {"username": "qa-admin", "password": "Synthetic-Password-123!"}
        before = self.storage.audit_page()["total"]
        self.assertEqual(self.call(path, body=body, headers={"Content-Type": "text/plain", "Origin": "https://elsewhere.test"})[0], 403)
        guard = {**self.guard, "Host": "127.0.0.1", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "panel.example.test", "X-Forwarded-Port": "2087"}
        self.assertEqual(self.call(path, body=body, headers={**guard, "Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.call(path, body=body, headers={**guard, "Origin": "https://panel.example.test"})[0], 403)
        self.assertEqual(self.call(path, body=body, headers={**guard, "Content-Type": "text/plain"})[0], 415)
        deep = '{"extra":' + '[' * 1200 + "0" + ']' * 1200 + '}'
        self.assertEqual(self.call(path, body=deep)[:2], (400, {"error": "invalid_json"}))
        self.assertEqual(self.storage.audit_page()["total"], before)
        self.assertEqual(self.call(path, body=body, headers={**guard, "Origin": "https://panel.example.test:2087"})[0], 200)
        self.assertEqual(self.call("/api/v2/health", "GET")[0], 200)

    def test_concurrent_ui_edits_merge_and_leave_deployment_retention_unpinned(self):
        path = "/api/v2/settings/ui"
        ready = threading.Barrier(2)
        def update(body):
            ready.wait(5)
            return self.call(path, "PUT", body)[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(update, ({"panelTitle": "QA Panel"}, {"idleTimeoutMinutes": 5})))
        self.assertEqual(result, [200, 200])
        saved = self.storage.get_setting("ui_settings", {})
        self.assertEqual((saved["panelTitle"], saved["idleTimeoutMinutes"]), ("QA Panel", 5))
        self.assertNotIn("auditRetentionDays", saved)
        self.assertEqual(self.storage.audit_retention(), 3650)
        self.assertEqual(self.storage.audit_page()["total"], 2)

    def test_network_ack_does_not_change_three_other_categories_or_badges(self):
        with self.storage.connect() as db:
            now = datetime.now(timezone.utc).isoformat()
            for alert_id in ("network-example", "service-example", "certificate-example", "traffic-example"):
                db.execute("INSERT INTO alert_history(episode_id,alert_id,started_at,payload_json) VALUES (?,?,?,?)",
                           (alert_id, alert_id, now, json.dumps({"severity": "critical"})))
            db.execute("INSERT INTO alert_state(alert_id,episode_id,started_at,active) VALUES(?,?,?,1)",
                       ("network-example", "network-example", now))
        status, body, _ = self.call("/api/v2/network/alerts/ack-all")
        self.assertEqual(status, 200)
        self.assertEqual((body["count"], body["network"]["pending"], body["summary"]["pending"], body["summary"]["critical"]), (1, 0, 3, 3))
        with self.storage.connect() as db:
            self.assertIsNotNone(db.execute("SELECT acknowledged_at FROM alert_state WHERE alert_id='network-example'").fetchone()[0])

    def test_audit_search_body_and_legacy_query_do_not_log_search_text(self):
        marker = "synthetic-private-query"
        self.storage.add_audit("event", "系统", marker)
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            status, result, _ = self.call("/api/v2/audits/search", body={"search": marker, "page": 1, "pageSize": 30})
            self.assertEqual(self.call("/api/v2/audits?search=" + marker, "GET")[0], 400)
        self.assertEqual((status, result["total"]), (200, 1))
        self.assertNotIn(marker, captured.getvalue())


class CollectionAuditRegressions(unittest.TestCase):
    def test_dst_gap_and_fold_have_monotonic_unique_boundaries(self):
        base = {"autoReset": True, "periodUnit": "day", "timezone": "America/New_York", "resetAnchor": "2026-01-01"}
        def cycle(at, reset):
            now = datetime.fromisoformat(at)
            start, end, _ = traffic_quota_period(now, {**base, "resetTime": reset})
            self.assertLessEqual(start, now)
            self.assertGreater(end, now)
            return start
        self.assertEqual(cycle("2026-03-08T07:20:00+00:00", "02:30").day, 7)
        self.assertEqual(cycle("2026-03-08T07:30:00+00:00", "02:30").hour, 7)
        self.assertEqual(cycle("2026-11-01T05:45:00+00:00", "01:30"), cycle("2026-11-01T06:00:00+00:00", "01:30"))

    def test_previous_hour_does_not_break_empty_new_cycle(self):
        with tempfile.TemporaryDirectory() as folder:
            now = (int(time.time()) // 3600) * 3600
            storage = Storage(str(Path(folder) / "state.db"))
            storage.record_sample(now - 120, 0, 0, 0, 0)
            storage.record_sample(now - 60, 10, 20, 0, 0)
            usage = storage.traffic_usage_since(now)
            self.assertEqual(usage["usedBytes"], 0)
            self.assertIsNone(usage["coverage"]["firstSampleAt"])

    def test_account_order_and_duplicate_or_missing_observations(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "state.db")
            service = DashboardService(AppConfig(database_path=path), Storage(path))
            seen = {"id": "a", "trafficIdentities": ["a", "a"]}
            missed = {"id": "b", "trafficIdentities": ["b"]}
            unmapped = {"id": "c"}
            hy2 = {"traffic": {"a": {"tx": 30, "rx": 0}}, "online": {"a": 1}, "available": True}
            for rows in ([seen, missed, unmapped], [unmapped, missed, seen]):
                out = {row["id"]: row for row in service.account_metrics(rows, hy2, 0)}
                self.assertEqual((out["a"]["usedBytes"], out["a"]["onlineDevices"]), (30, 1))
                self.assertEqual((out["b"]["coreEvidence"], out["c"]["coreEvidence"]), ("notObserved", "unknown"))

    def test_dns_proves_the_queried_owner_or_its_cname_target(self):
        name = b"\x07example\x03com\0"
        question = name + struct.pack("!HH", 1, 1)
        header = lambda count, flags=0x8180: struct.pack("!6H", 1234, flags, 1, count, 0, 0)
        record = lambda owner, rr_type, data: owner + struct.pack("!HHIH", rr_type, 1, 60, len(data)) + data
        self.assertTrue(verified_a_response(header(1) + question + record(b"\xc0\x0c", 1, bytes((192, 0, 2, 1))), 1234, "example.com"))
        cname = b"\x05alias\xc0\x0c"
        chain = record(b"\xc0\x0c", 5, cname) + record(cname, 1, bytes((192, 0, 2, 1)))
        self.assertTrue(verified_a_response(header(2) + question + chain, 1234, "example.com"))
        for packet in (header(1) + question + b"\0" * 16, header(2) + question + chain[:-1],
                       header(2, 0x8380) + question + chain, header(1) + question + record(cname, 1, b"\0" * 4),
                       header(1) + question + record(b"\xc0\xff", 1, b"\0" * 4)):
            self.assertFalse(verified_a_response(packet, 1234, "example.com"))

    def test_mixed_subscription_preserves_valid_record(self):
        body = b"vless://synthetic@example.test:443\nvless://invalid@[2001:db8::1:443\n"
        self.assertEqual(_parse_subscription(body, "text/plain"), {"format": "uri-list", "nodeCount": 1, "invalidNodeCount": 1})
        for host in ("224.0.0.251", "ff02::1", "::ffff:127.0.0.1"):
            with self.assertRaises(ValueError):
                _require_public_host(host)
        with self.assertRaisesRegex(ValueError, "port"):
            normalize_loopback_endpoint("http://127.0.0.1:99999")


if __name__ == "__main__":
    unittest.main()
