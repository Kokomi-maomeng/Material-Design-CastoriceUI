"""Monitoring fault injection, immutable evidence and certificate safety."""
import copy
from datetime import datetime, timezone
import hashlib
import hmac
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import tarfile

from castoriceui.collectors import ping_target, layered_probe, service_snapshots, cached_metadata, _metadata_cache
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.external_probe import accept, canonical, service_evidence
from castoriceui.monitoring import NetworkPolicy, periodic, correlate, maintenance_info
from castoriceui.storage import Storage
import test_service_health as health
import test_v45_regressions as v45


def sample(loss=0, sent=8, received=None, complete=True, key="one", latency=10):
    return {"id": key, "name": "Synthetic", "latency": latency, "loss": loss,
            "sent": sent, "received": round(sent * (1-loss/100)) if received is None else received,
            "complete": complete, "status": "down" if loss == 100 else "degraded" if loss else "healthy", "ipVersion": 4}


THRESHOLDS = {"latencyMs": 150., "lossPercent": 5.}


class SupplementalEvidenceTests(unittest.TestCase):
    def test_real_network_alert_path_retains_first_and_worst_sample_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "qa.sqlite"))
            dashboard = DashboardService(AppConfig(), storage)
            dashboard.collection_state["network"] = {"observedAt": datetime.now(timezone.utc).isoformat()}
            for loss in (10, 30, 15):
                target = {**sample(loss), "alertConfirmed": True, "observedAt": "2026-01-01T00:00:00Z", "effectivePolicy": THRESHOLDS, "layers": {"tcp": {"status": "passed"}}}
                dashboard.alerts({"trafficUsedBytes": 0, "trafficLimitBytes": 100}, [], [target])
            with storage.connect() as connection:
                row = connection.execute("SELECT * FROM alert_evidence").fetchone()
            first, worst, last = [json.loads(row[key])["evidence"] for key in ("first_json", "worst_json", "last_json")]
            self.assertEqual((first["loss"], worst["loss"], last["loss"]), (10, 30, 15))
            self.assertEqual(worst["effectivePolicy"], THRESHOLDS)
            self.assertEqual(worst["layers"]["tcp"]["status"], "passed")

    def test_core_group_preserves_independent_errors_and_business_failure_title(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "qa.sqlite"))
            dashboard = DashboardService(AppConfig(), storage)
            services = [
                {"id": "singbox", "name": "sing-box", "status": "stopped", "detail": "Core inactive"},
                {"id": "anytls", "name": "AnyTLS", "status": "stopped", "detail": "Core inactive", "stateReason": "core_offline"},
                {"id": "vless", "name": "VLESS", "status": "warning", "detail": "Independent mapping error", "stateReason": "configuration_unverified"},
                {"id": "external-qa-anytls", "name": "AnyTLS external", "status": "warning", "detail": "Forwarding failed", "stateReason": "external_business_failure", "alertConfirmed": True},
            ]
            alerts = {x["id"]: x for x in dashboard.alerts({"trafficUsedBytes": 0, "trafficLimitBytes": 100}, services, [])}
            self.assertNotIn("service-anytls", alerts)
            self.assertEqual(alerts["service-singbox"]["affectedServices"], ["anytls"])
            self.assertIn("AnyTLS", alerts["service-singbox"]["descriptionZh"])
            self.assertIn("monitor-vless", alerts)
            self.assertIn("business check failed", alerts["monitor-external-qa-anytls"]["titleEn"])

    def test_confirmed_core_stop_overrides_stale_successful_statistics(self):
        with patch("castoriceui.collectors.service_state", return_value=("failed", 0)), patch("castoriceui.collectors.run", return_value="1.13.19"):
            services = service_snapshots(health.config(), health.SYSTEM, {"available": True}, {"available": True, "inventory": health.inventory()})
        self.assertEqual(next(x for x in services if x["id"] == "singbox")["status"], "stopped")
        self.assertEqual(next(x for x in services if x["id"] == "hysteria2")["status"], "stopped")

    def test_missing_configuration_cannot_hide_stop_and_transition_cannot_claim_healthy(self):
        cfg = health.config()
        cfg.hysteria_api = {}
        cfg.integrations["hysteria2"]["configured"] = True
        for active in ("inactive", "activating"):
            with self.subTest(active=active), patch("castoriceui.collectors.service_state", return_value=(active, 0)), patch("castoriceui.collectors.run", return_value="1.13.19"):
                services = service_snapshots(cfg, health.SYSTEM, {"available": True}, {"available": True, "inventory": health.inventory()})
            states = {x["id"]: x["status"] for x in services}
            self.assertEqual(states["hysteria2"], "stopped" if active == "inactive" else "warning")
            self.assertEqual(states["anytls"], "stopped" if active == "inactive" else "warning")

    def test_unknown_samples_do_not_resolve_existing_network_or_listener_faults(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "qa.sqlite"))
            dashboard = DashboardService(AppConfig(), storage)
            dashboard.collection_state["network"] = {"observedAt": datetime.now(timezone.utc).isoformat()}
            system = {"trafficUsedBytes": 0, "trafficLimitBytes": 100}
            target = {**sample(12.5), "alertConfirmed": True}
            service = {"id": "anytls", "name": "AnyTLS", "status": "stopped", "detail": "Listener missing", "stateReason": "listener_missing"}
            dashboard.alerts(system, [service], [target])
            initial = {x["id"]: x["episodeId"] for x in storage.active_alerts()}
            service.update(status="warning", stateReason="inventory_stale")
            target.update(status="unavailable", complete=False, loss=None, latency=None, probeReason="timeout")
            for reason in ("inventory_stale", "statistics_unavailable", "core_state_unconfirmed", "configuration_unverified"):
                service["stateReason"] = reason
                dashboard.alerts(system, [service], [target])
                continued = {x["id"]: x["episodeId"] for x in storage.active_alerts()}
                self.assertEqual(continued["service-anytls"], initial["service-anytls"])
                self.assertEqual(continued["network-one"], initial["network-one"])
            service.update(status="running", stateReason="verified")
            target.update(status="healthy", complete=True, loss=0, latency=10, alertConfirmed=False)
            dashboard.alerts(system, [service], [target])
            self.assertFalse(storage.active_alerts())

    def test_short_or_wrong_dns_response_is_failed_evidence_without_crashing(self):
        from unittest.mock import MagicMock
        sock = MagicMock()
        sock.__enter__.return_value = sock
        for response in (b"x", b"\x00" * 20):
            sock.recv.return_value = response
            with patch("castoriceui.collectors.socket.socket", return_value=sock):
                result = layered_probe({"address": "192.0.2.1", "ipVersion": 4, "dnsPort": 53})
            self.assertEqual(result["dns"]["status"], "failed")

    def test_external_business_confirmation_recovery_and_observer_scope(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "qa.sqlite"))
            config = AppConfig(external_probe_secret="s" * 40, external_probe_agents=["qa"])
            now = int(time.time())
            def report(status, at, healthy=True):
                storage.record_monitoring("external", "qa", {"agentId": "qa", "observedAt": at, "agentHealthy": healthy, "protocols": {"anytls": {"status": status, "failedStage": "authentication" if status == "failed" else ""}}})
            def get(active=set(), at=now):
                return service_evidence(config, storage, active, now=at, startup_age=200)[0]
            report("failed", now - 60)
            self.assertFalse(get()["alertConfirmed"])
            report("failed", now)
            item = get()
            self.assertTrue(item["alertConfirmed"])
            self.assertEqual(item["stateReason"], "external_business_failure")
            self.assertEqual(item["status"], "warning")
            report("passed", now)
            self.assertTrue(get({"external-qa-anytls"})["alertConfirmed"])
            report("passed", now)
            self.assertFalse(get({"external-qa-anytls"})["alertConfirmed"])
            report("unavailable", now, False)
            self.assertEqual(get()["stateReason"], "external_observer_unavailable")
            self.assertEqual(get(at=now+181)["stateReason"], "external_observer_unavailable")

    def test_expired_maintenance_is_visible_and_closed_window_is_not_expired(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "state.json"
            data = {"id": "qa", "state": "activating", "startedAt": 100, "expiresAt": 160}
            path.write_text(json.dumps(data))
            self.assertTrue(maintenance_info(path, now=161)["expired"])
            data["state"] = "verified"
            path.write_text(json.dumps(data))
            self.assertFalse(maintenance_info(path, now=161)["expired"])
            data["expiresAt"] = 99999
            path.write_text(json.dumps(data))
            self.assertEqual(maintenance_info(path)["state"], "invalid")

    def test_external_clock_skew_uses_server_receipt_without_extending_expiry(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "qa.sqlite"))
            config = AppConfig(external_probe_secret="s" * 40, external_probe_agents=["qa"])
            now = int(time.time())
            def report(status, observed, received):
                storage.record_monitoring("external", "qa", {"agentId": "qa", "observedAt": observed, "agentHealthy": True, "protocols": {"anytls": {"status": status}}}, now=received)
            def get(at=now):
                return service_evidence(config, storage, {"external-qa-anytls"}, now=at, startup_age=200)[0]
            report("passed", now + .3, now)
            report("passed", now + .3, now)
            self.assertEqual(get()["stateReason"], "external_business_passed")
            self.assertFalse(get()["alertConfirmed"])
            self.assertEqual(get(now+181)["stateReason"], "external_observer_unavailable")
            report("failed", now + .3, now)
            report("failed", now + .3, now)
            self.assertEqual(get()["stateReason"], "external_business_failure")
            self.assertTrue(get()["alertConfirmed"])
            report("passed", now + 61, now)
            self.assertEqual(get()["stateReason"], "external_observer_unavailable")
            report("passed", now - 181, now)
            self.assertEqual(get()["stateReason"], "external_observer_unavailable")
            report("passed", now, now - 181)
            self.assertEqual(get()["stateReason"], "external_observer_unavailable")

    def test_external_agent_failure_categories_and_no_private_log_in_result(self):
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("external_agent_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        self.assertEqual(agent.failure_stage(b"authentication failed at private.invalid", "anytls", "transport"), "authentication")
        self.assertEqual(agent.failure_stage(b"timeout: no recent network activity", "hysteria2", "authentication"), "quic")
        self.assertEqual(agent.failure_stage(b"x509 validation failed", "anytls", "authentication"), "tls")
        self.assertEqual(agent.failure_stage(b"remote dial connection refused", "anytls", "authentication"), "forwarding")

    def test_observer_target_failure_does_not_hide_healthy_alternate_path(self):
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("observer_alternate_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        config = {"testUrl": "https://example.com", "observerUrls": ["https://one.example.com", "https://two.example.com"]}
        def fetch(_config, url):
            if url == config["observerUrls"][0]:
                raise OSError("synthetic target unavailable")
            return b"healthy"
        with patch.object(agent, "direct_fetch", side_effect=fetch):
            self.assertTrue(agent.observer_healthy(config))
        with patch.object(agent, "direct_fetch", side_effect=OSError("both unavailable")):
            self.assertFalse(agent.observer_healthy(config))

    def test_observer_health_targets_are_https_and_bounded(self):
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("observer_validation_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        with patch.object(agent, "direct_fetch", return_value=b"healthy") as fetch:
            self.assertTrue(agent.observer_healthy({"testUrl": "https://example.com"}))
            fetch.assert_called_once()
            fetch.reset_mock()
            for urls in ([], ["https://example.com"] * 3, "https://example.com", ["http://example.com"], ["https://user:password@example.com"]):
                self.assertFalse(agent.observer_healthy({"testUrl": "https://example.com", "observerUrls": urls}))
            fetch.assert_not_called()

    def test_upstream_tls_failure_after_socks_success_is_forwarding_evidence(self):
        from unittest.mock import MagicMock
        import ssl
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("external_forwarding_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        context = MagicMock()
        context.wrap_socket.side_effect = ssl.SSLError("synthetic upstream TLS failure")
        evidence = {"failedStage": "transport"}
        with patch.object(agent.socket, "create_connection", return_value=MagicMock()), patch.object(agent, "read_exact", side_effect=[b"\x05\x00", b"\x05\x00\x00\x01", b"\x00"*6]), patch.object(agent.ssl, "create_default_context", return_value=context):
            with self.assertRaises(ssl.SSLError):
                agent.open_tunnel(1, "https://example.com", evidence)
        self.assertEqual(evidence["failedStage"], "forwarding")

    def test_external_windows_interface_binding_is_socket_local_and_network_order(self):
        import struct
        from unittest.mock import MagicMock
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("external_binding_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        stream = MagicMock()
        with patch.object(agent.sys, "platform", "win32"):
            agent.bind_probe_socket(stream, {"interfaceIndex": 7})
        stream.setsockopt.assert_called_once_with(agent.socket.IPPROTO_IP, getattr(agent.socket, "IP_UNICAST_IF", 31), struct.pack("!I", 7))

    def test_external_direct_dns_ignores_system_fake_ip_and_rejects_wrong_id(self):
        import struct
        from unittest.mock import MagicMock
        path = Path(__file__).resolve().parents[2] / "deploy/external-probe.py"
        spec = importlib.util.spec_from_file_location("external_dns_qa", path)
        agent = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agent)
        question = b"\x07example\x03com\x00\x00\x01\x00\x01"
        response = struct.pack("!6H", 12, 0x8180, 1, 1, 0, 0) + question + b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + b"\xc0\x00\x02\x01"
        stream = MagicMock()
        stream.__enter__.return_value = stream
        stream.recv.return_value = response
        with patch.object(agent.socket, "socket", return_value=stream), patch.object(agent.secrets, "randbelow", return_value=12), patch.object(agent.socket, "getaddrinfo", side_effect=AssertionError("system fake IP resolver used")):
            self.assertEqual(agent.resolve_direct("example.com", {"resolverAddress": "192.0.2.53"}), "192.0.2.1")
        with patch.object(agent.socket, "socket", return_value=stream), patch.object(agent.secrets, "randbelow", return_value=13):
            with self.assertRaises(ValueError):
                agent.resolve_direct("example.com", {"resolverAddress": "192.0.2.53"})

    def test_certificate_transaction_failure_restores_material_and_closes_window(self):
        path = Path(__file__).resolve().parents[2] / "deploy/receive-certificate.py"
        spec = importlib.util.spec_from_file_location("certificate_qa", path)
        receiver = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(receiver)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cert, key, livecert, livekey, state = [root / name for name in ("cert", "key", "livecert", "livekey", "state.json")]
            for target, content in ((cert, b"newcert"), (key, b"newkey"), (livecert, b"oldcert"), (livekey, b"oldkey")):
                target.write_bytes(content)
            config = {"hostname": "panel.example.com", "certificatePath": str(livecert), "keyPath": str(livekey), "backupDirectory": str(root / "backup"), "reloadNginx": False}
            def substitute(src, dst):
                dst.write_bytes(src.read_bytes())
            with patch.object(receiver, "validate", side_effect=["newsha", "oldsha"]), patch.object(receiver, "replace", side_effect=substitute), patch.object(receiver, "activated", side_effect=[False, True]):
                with self.assertRaises(ValueError):
                    receiver.install(config, cert, key, state)
            self.assertEqual(livecert.read_bytes(), b"oldcert")
            self.assertEqual(livekey.read_bytes(), b"oldkey")
            self.assertEqual(json.loads(state.read_text())["state"], "rolled_back")
            with patch.object(receiver, "validate", side_effect=["newsha", ValueError("old_invalid")]):
                with self.assertRaises(ValueError):
                    receiver.install(config, cert, key, state)
            self.assertEqual(json.loads(state.read_text())["state"], "preparation_failed")


class MonitoringPolicyTests(unittest.TestCase):
    def test_isolated_loss_is_visible_without_a_confirmed_episode(self):
        policy = NetworkPolicy()
        values = []
        for i, loss in enumerate([0, 0, 12.5, 0, 0, 0]):
            result = policy.apply([sample(loss)], THRESHOLDS, i*20)[0]
            values.append(result["alertConfirmed"])
            if loss:
                self.assertEqual(result["status"], "degraded")
        self.assertFalse(any(values))

    def test_sustained_loss_and_two_good_round_recovery(self):
        policy = NetworkPolicy()
        for i in range(3):
            result = policy.apply([sample(12.5)], THRESHOLDS, i*20)[0]
        self.assertTrue(result["alertConfirmed"])
        self.assertTrue(policy.apply([sample(0)], THRESHOLDS, 60)[0]["alertConfirmed"])
        self.assertFalse(policy.apply([sample(0)], THRESHOLDS, 80)[0]["alertConfirmed"])

    def test_partial_results_never_confirm_recovery_or_invent_packet_counts(self):
        policy = NetworkPolicy()
        for i in range(3):
            policy.apply([sample(100)], THRESHOLDS, i*20)
        result = policy.apply([sample(0, complete=False)], THRESHOLDS, 60)[0]
        self.assertTrue(result["alertConfirmed"])
        self.assertEqual(result["qualityWindow"]["sent"], 24)

    def test_weighted_counts_overrides_single_family_and_missing_are_independent(self):
        policy = NetworkPolicy()
        policy.apply([sample(10, sent=100, received=90)], THRESHOLDS, 0)
        result = policy.apply([sample(0, sent=4, received=4)], THRESHOLDS, 20)[0]
        self.assertAlmostEqual(result["qualityWindow"]["loss"], 9.62, places=2)
        result = policy.apply([{**sample(12.5), "lossPercent": 20}], THRESHOLDS, 40)[0]
        self.assertEqual(result["status"], "healthy")
        for i in range(3):
            result = policy.apply([{**sample(100, key="v6"), "ipVersion": 6}, sample(key="v4")], THRESHOLDS, 100+i*20)
        self.assertTrue(result[0]["alertConfirmed"])
        self.assertFalse(result[1]["alertConfirmed"])
        self.assertEqual(correlate(result)["ipVersions"], [6])
        self.assertEqual(correlate(result)["rootCause"], "insufficient_evidence")

    def test_corroborated_transport_failure_is_fast_but_icmp_blocking_is_not_business_failure(self):
        policy = NetworkPolicy()
        result = policy.apply([{**sample(100), "layers": {"tcp": {"configured": True, "status": "failed"}}}], THRESHOLDS, 0)[0]
        self.assertTrue(result["alertConfirmed"])
        policy = NetworkPolicy()
        result = policy.apply([{**sample(100), "layers": {"tcp": {"configured": True, "status": "passed"}}}], THRESHOLDS, 0)[0]
        self.assertEqual(result["status"], "down")
        self.assertFalse(result["alertConfirmed"])

    def test_timeout_preserves_only_observed_partial_ping_output(self):
        error = subprocess.TimeoutExpired(["ping"], 4, output=b"64 bytes: icmp_seq=1 time=9.0 ms\n")
        with patch("castoriceui.collectors.shutil.which", return_value="ping"), patch("castoriceui.collectors.subprocess.run", side_effect=error):
            result = ping_target({"id": "test", "address": "192.0.2.1"})
        self.assertFalse(result["complete"])
        self.assertEqual(result["history"], [9.])
        self.assertIsNone(result["sent"])
        self.assertIsNone(result["loss"])
        self.assertEqual(result["probeReason"], "timeout")

    def test_blocked_task_does_not_stop_another_domain_and_no_overlap(self):
        stop, blocked = threading.Event(), threading.Event()
        count = []
        thread = periodic(stop, "synthetic-slow", .02, lambda: blocked.wait(.3))
        other = periodic(stop, "synthetic-fast", .02, lambda: count.append(time.monotonic()))
        time.sleep(.08)
        stop.set(); blocked.set(); thread.join(1); other.join(1)
        self.assertGreaterEqual(len(count), 3)
        self.assertFalse(thread.is_alive())


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = Storage(str(Path(self.temp.name)/"state.db"))
        self.dashboard = DashboardService(AppConfig(database_path=self.storage.path), self.storage)

    def tearDown(self):
        self.temp.cleanup()

    def test_startup_budget_expires_once_and_success_does_not_reset_it(self):
        self.assertEqual(self.dashboard.collection_alerts(), [])
        self.dashboard.started_monotonic -= 31
        self.assertEqual(len(self.dashboard.collection_alerts()), 3)
        now = "2000-01-01T00:00:00+00:00"
        self.dashboard.runtime_cache["observedAt"] = now
        self.dashboard._collection_result("runtime", observed_at=now)
        self.assertEqual(self.dashboard.collection_freshness()["runtime"]["status"], "stale")

    def test_first_and_worst_values_survive_updates_and_recurrence(self):
        def alert(loss): return {"id": "network-test", "severity": "warning", "evidence": {"loss": loss}}
        first = self.storage.reconcile_alerts([alert(10)])["network-test"]["episodeId"]
        self.storage.reconcile_alerts([alert(30)])
        self.storage.reconcile_alerts([alert(15)])
        with self.storage.connect() as db:
            row = db.execute("SELECT * FROM alert_evidence WHERE episode_id=?", (first,)).fetchone()
        self.assertEqual(json.loads(row["first_json"])["evidence"]["loss"], 10)
        self.assertEqual(json.loads(row["last_json"])["evidence"]["loss"], 15)
        self.assertEqual(json.loads(row["worst_json"])["evidence"]["loss"], 30)
        self.storage.reconcile_alerts([])
        self.assertEqual(self.storage.alert_summary()["active"], 0)
        self.assertEqual(self.storage.alert_page(status="recovered")["total"], 1)
        new = self.storage.reconcile_alerts([alert(20)])["network-test"]["episodeId"]
        self.assertNotEqual(first, new)
        self.storage.acknowledge(first)
        self.assertEqual(self.storage.alert_page(status="active")["total"], 1)

    def test_retention_invalid_payload_and_disk_errors_are_bounded(self):
        self.assertTrue(self.storage.record_monitoring("network", "one", sample(), now=int(time.time())))
        self.assertFalse(self.storage.record_monitoring("network", "one", {"value": "x"*40000}))
        with patch.object(self.storage, "connect", side_effect=sqlite3.OperationalError("synthetic disk full")):
            self.assertFalse(self.storage.record_monitoring("network", "one", sample()))
        self.assertEqual(len(self.storage.monitoring_history("network", "one")), 1)

    def test_unknown_inventory_never_becomes_offline_but_missing_listener_does(self):
        cfg = health.config()
        with patch("castoriceui.collectors.service_state", return_value=("active", 60)), patch("castoriceui.collectors.run", return_value="1.13.19"):
            services = service_snapshots(cfg, health.SYSTEM, {"available": True}, {"available": True, "inventory": {"available": False, "reason": "inventory_stale"}})
            self.assertEqual(next(item for item in services if item["id"] == "anytls")["status"], "warning")
            inventory = health.inventory(); inventory["inbounds"][0]["listening"] = False
            services = service_snapshots(cfg, health.SYSTEM, {"available": True}, {"available": True, "inventory": inventory})
            self.assertEqual(next(item for item in services if item["id"] == "anytls")["status"], "stopped")

    def test_metadata_cache_invalidation_and_expiry(self):
        _metadata_cache.clear()
        calls = []
        def check(): calls.append(1); return len(calls)
        self.assertEqual(cached_metadata(("test", 1), 300, check), 1)
        self.assertEqual(cached_metadata(("test", 1), 300, check), 1)
        self.assertEqual(cached_metadata(("test", 2), 300, check), 2)
        self.assertEqual(cached_metadata(("test", 1), 0, check), 3)

    def test_signed_external_evidence_rejects_replay_expiry_and_tampering(self):
        cfg = AppConfig(external_probe_secret="synthetic-probe-test-key-000000000000", external_probe_agents=["qa"])
        payload = {"agentId": "qa", "nonce": "synthetic-nonce-00001", "observedAt": int(time.time()), "agentHealthy": True, "protocols": {"anytls": {"status": "passed", "durationMs": 100}}}
        def sign(p): return hmac.new(cfg.external_probe_secret.encode(), canonical(p), hashlib.sha256).hexdigest()
        signature = sign(payload)
        self.assertTrue(accept(cfg, self.storage, payload, signature))
        self.assertFalse(accept(cfg, self.storage, payload, signature))
        forged = {**payload, "nonce": "synthetic-nonce-00002"}
        self.assertFalse(accept(cfg, self.storage, forged, signature))
        expired = {**forged, "observedAt": int(time.time())-120}
        self.assertFalse(accept(cfg, self.storage, expired, sign(expired)))
        invalid = copy.deepcopy(forged); invalid["protocols"]["anytls"]["secret"] = "not-accepted"
        self.assertFalse(accept(cfg, self.storage, invalid, sign(invalid)))


class MonitoringApiTests(unittest.TestCase):
    setUp = v45.AuditRegressions.setUp
    tearDown = v45.AuditRegressions.tearDown
    start_api = v45.AuditRegressions.start_api
    initialize = v45.AuditRegressions.initialize
    call = v45.AuditRegressions.call

    def test_diagnostic_requires_auth_and_active_filters_are_real(self):
        self.start_api()
        self.assertEqual(self.call("GET", "/api/v2/monitoring")[0], 401)
        self.initialize()
        self.assertEqual(self.call("GET", "/api/v2/monitoring")[0], 200)
        self.assertEqual(self.call("GET", "/api/v2/alerts?filter=active")[1]["total"], 0)
        self.assertEqual(self.call("GET", "/api/v2/alerts?filter=recovered")[1]["total"], 0)


class CertificateArchiveTests(unittest.TestCase):
    def test_certificate_archive_rejects_paths_links_and_extra_files(self):
        path = Path(__file__).resolve().parents[2]/"deploy/receive-certificate.py"
        spec = importlib.util.spec_from_file_location("certificate_receiver", path)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        for name in ["../fullchain.pem", "extra.txt", "/fullchain.pem"]:
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode="w") as archive:
                for entry in [name, "privkey.pem"]:
                    info = tarfile.TarInfo(entry); info.size = 4; archive.addfile(info, io.BytesIO(b"test"))
            with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
                module.unpack(stream.getvalue(), Path(folder))


if __name__ == "__main__":
    unittest.main()
