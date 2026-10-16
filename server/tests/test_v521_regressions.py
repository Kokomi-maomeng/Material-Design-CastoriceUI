"""A backend restart is not evidence of external business recovery."""
import tempfile
import time
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.alert_policy import AlertPolicy
from castoriceui.config import AppConfig
from castoriceui.external_probe import service_evidence
from castoriceui.storage import Storage


class ExternalRestartTests(unittest.TestCase):
    def test_acknowledged_open_incident_and_observer_survive_restart_without_new_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "state.db"))
            config = AppConfig(external_probe_secret="x" * 32, external_probe_agents=["qa"], external_probe_protocols={"qa": ["anytls", "hysteria2"]})
            storage.set_setting("external_business_incidents", {"external-qa-anytls": False, "external-qa-hysteria2": True})
            candidates = [
                {"id": "monitor-external-qa-hysteria2", "severity": "info", "reason": "external_observer_unavailable", "evidence": {"agentId": "qa", "protocol": "hysteria2", "businessIncidentActive": True}},
                {"id": "observer-qa", "severity": "info", "reason": "external_observer_unavailable", "evidence": {"agentId": "qa", "protocol": "anytls", "businessIncidentActive": False}},
            ]
            original = storage.reconcile_alerts(candidates)
            for item in original.values():
                storage.acknowledge(item["episodeId"])
            previous = storage.active_alerts()
            known = {"external-qa-hysteria2", "observer-qa"}
            services = service_evidence(config, storage, known, now=time.time(), startup_age=0)
            self.assertTrue(all(service["alertConfirmed"] for service in services))
            restarted_candidates = [{"id": "monitor-" + service["id"], "severity": "info", "reason": service["stateReason"], "evidence": service["evidence"]} for service in services if service["alertConfirmed"]]
            kept = AlertPolicy().apply(restarted_candidates, previous, now=0)
            storage.reconcile_alerts(kept)
            after = storage.active_alerts()
            self.assertEqual({item["episodeId"] for item in after}, {item["episodeId"] for item in previous})
            self.assertTrue(all(item["acknowledgedAt"] for item in after))
            self.assertEqual(storage.alert_page()["total"], 2)
            self.assertEqual(storage.alert_summary()["pending"], 0)

    def test_new_unknown_observer_still_waits_for_startup_and_quiet_windows(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / "state.db"))
            config = AppConfig(external_probe_secret="x" * 32, external_probe_agents=["qa"], external_probe_protocols={"qa": ["anytls"]})
            services = service_evidence(config, storage, set(), now=time.time(), startup_age=0)
            self.assertFalse(services[0]["alertConfirmed"])
            services = service_evidence(config, storage, set(), now=time.time(), startup_age=180)
            self.assertTrue(services[0]["alertConfirmed"])
            candidate = {"id": "monitor-" + services[0]["id"], "severity": "info", "reason": services[0]["stateReason"], "evidence": services[0]["evidence"]}
            policy = AlertPolicy()
            self.assertEqual(policy.apply([candidate], [], now=0), [])
            self.assertEqual(policy.apply([candidate], [], now=599), [])
            self.assertEqual(len(policy.apply([candidate], [], now=600)), 1)


if __name__ == "__main__":
    unittest.main()
