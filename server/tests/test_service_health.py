from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.collectors import PROTOCOLS, protocol_readiness, read_protocol_inventory, service_snapshots, valid_singbox_payload
from castoriceui.config import AppConfig, DEFAULT_INTEGRATIONS
from castoriceui.dashboard import DashboardService
from castoriceui.protocol_probe import config_paths, inbound_records, owned_listeners
from castoriceui.storage import Storage


SYSTEM = {"cpuCores": 2, "load": [0.1], "kernel": "6.12", "uptimeSeconds": 60}
API = {"uploadTotal": 0, "downloadTotal": 0, "connections": []}


def inventory():
    return {"available": True, "apiPort": 19091, "inbounds": [{"tag": key + "-in", "type": "socks" if key == "socks5" else key, "listening": True, "securityProfile": "standard"} for key in PROTOCOLS]}


def config():
    return AppConfig(integrations=copy.deepcopy(DEFAULT_INTEGRATIONS),
                     hysteria_api={"url": "http://127.0.0.1:19090"},
                     singbox_api={"url": "http://127.0.0.1:19091", "secret": "test-only"},
                     protocol_adapters={key: {"inboundTags": [key + "-in"]} for key in PROTOCOLS})


class ProtocolHealthTests(unittest.TestCase):
    def services(self, cfg, snapshot=None, active="active"):
        with patch("castoriceui.collectors.service_state", return_value=(active, 60)), patch("castoriceui.collectors.run", return_value="1.13.19"):
            return service_snapshots(cfg, SYSTEM, {"available": True}, snapshot or {"available": True, "inventory": inventory()})

    def test_all_configured_protocols_have_independent_cards_and_unconfigured_are_absent(self):
        cfg = config()
        protocols = [s for s in self.services(cfg) if s.get("kind") == "protocol"]
        self.assertEqual({s["id"] for s in protocols}, {"hysteria2", *PROTOCOLS})
        self.assertTrue(all(s["status"] == "running" for s in protocols))
        cfg.protocol_adapters = {"vless": cfg.protocol_adapters["vless"]}
        cfg.hysteria_api = {}
        self.assertEqual([s["id"] for s in self.services(cfg) if s.get("kind") == "protocol"], ["vless"])

    def test_bad_mapping_does_not_inherit_a_healthy_shared_core(self):
        cfg = config()
        for change in ("absent", "wrong-type", "not-listening", "wrong-profile", "unavailable", "wrong-api"):
            with self.subTest(change=change):
                state = inventory()
                inbound = next(i for i in state["inbounds"] if i["type"] == "vless")
                if change == "absent": state["inbounds"].remove(inbound)
                if change == "wrong-type": inbound["type"] = "trojan"
                if change == "not-listening": inbound["listening"] = False
                if change == "wrong-profile": inbound["securityProfile"] = "reality"
                if change == "unavailable": state["available"] = False
                if change == "wrong-api": state["apiPort"] = 19092
                services = {s["id"]: s for s in self.services(cfg, {"available": True, "inventory": state})}
                self.assertEqual(services["singbox"]["status"], "running")
                self.assertEqual(services["vless"]["status"], "stopped")
                self.assertEqual(services["vless"]["version"], "unknown")
                self.assertNotIn("uptimeSeconds", services["vless"])
                if change not in {"unavailable", "wrong-api"}: self.assertEqual(services["anytls"]["status"], "running")

    def test_inactive_core_and_failed_api_make_every_configured_protocol_abnormal(self):
        for active, available in (("inactive", True), ("active", False)):
            services = self.services(config(), {"available": available, "inventory": inventory()}, active)
            self.assertTrue(all(s["status"] != "running" for s in services if s["id"] in PROTOCOLS))

    def test_partial_config_and_enabled_intent_remain_visible(self):
        cfg = AppConfig(integrations={"socks5": {"enabled": True}, "hysteria2": {"configured": True}})
        services = {s["id"]: s for s in self.services(cfg)}
        for key in ("socks5", "hysteria2"):
            self.assertEqual(services[key]["status"], "stopped")
            self.assertNotIn("uptimeSeconds", services[key])
        self.assertNotIn("anytls", services)

    def test_failed_setup_persists_only_intent_and_preserves_shared_endpoint_across_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = config()
            cfg.protocol_adapters = {"anytls": cfg.protocol_adapters["anytls"]}
            cfg.database_path = str(Path(directory) / "state.db")
            store = Storage(cfg.database_path)
            dashboard = DashboardService(cfg, store)
            original = copy.deepcopy(cfg.singbox_api)
            with self.assertRaisesRegex(ValueError, "required"):
                dashboard.configure_integration("socks5", {"values": {"endpoint": "", "inboundTags": ""}})
            state = store.get_setting("integration_overrides", {})["socks5"]
            self.assertEqual(state["values"], {})
            self.assertTrue(state["attempted"])
            DashboardService(cfg, store)
            self.assertEqual(cfg.singbox_api, original)
            self.assertEqual(cfg.protocol_adapters, {"anytls": {"inboundTags": ["anytls-in"]}})
            self.assertEqual(next(s for s in self.services(cfg) if s["id"] == "socks5")["status"], "stopped")
            states = {s["id"]: s for s in dashboard.runtime_integrations({"available": True}, {"available": True, "inventory": inventory()}, [])}
            self.assertEqual(states["socks5"]["status"], "error")
            self.assertEqual(states["anytls"]["status"], "ready")

    def test_setup_validates_real_inbound_and_recovery_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            cfg = config()
            cfg.database_path = str(Path(directory) / "state.db")
            store = Storage(cfg.database_path)
            dashboard = DashboardService(cfg, store)
            with patch("castoriceui.dashboard.http_json", return_value=API), patch("castoriceui.dashboard.read_protocol_inventory", return_value=inventory()):
                for key in PROTOCOLS:
                    values = {"endpoint": cfg.singbox_api["url"], "inboundTags": key + "-in"}
                    if key == "vless": values["securityProfile"] = "standard"
                    self.assertTrue(dashboard.configure_integration(key, {"values": values})["configured"])
                with self.assertRaisesRegex(ValueError, "mapped"):
                    dashboard.configure_integration("socks5", {"values": {"endpoint": cfg.singbox_api["url"], "inboundTags": "anytls-in"}})
                with self.assertRaisesRegex(ValueError, "same API"):
                    dashboard.configure_integration("socks5", {"values": {"endpoint": "http://127.0.0.1:19092", "inboundTags": "socks5-in"}})
            DashboardService(cfg, store)
            self.assertTrue(all(s["status"] == "running" for s in self.services(cfg) if s.get("kind") == "protocol"))
            self.assertNotIn("test-only", json.dumps(store.get_setting("integration_overrides", {})))

    def test_empty_and_malformed_api_responses_are_not_healthy(self):
        self.assertTrue(valid_singbox_payload(API))
        for response in ({}, None, {**API, "connections": None}, {**API, "connections": [None]}, {**API, "uploadTotal": "wrong"}, {**API, "uploadTotal": float("inf")}):
            self.assertFalse(valid_singbox_payload(response))

    def test_stale_or_restarted_inventory_cannot_report_health(self):
        payload = {"schema": 1, "pid": 123, "sampledAt": 100, **inventory()}
        for now, pid, expected in ((120, "123", True), (200, "123", False), (120, "124", False), (90, "123", False)):
            with patch("castoriceui.collectors.Path.stat") as stat, patch("castoriceui.collectors.Path.read_text", return_value=json.dumps(payload)), patch("castoriceui.collectors.time.time", return_value=now), patch("castoriceui.collectors.run", return_value=pid):
                stat.return_value.st_size = 100
                self.assertEqual(bool(read_protocol_inventory()), expected)

    def test_probe_allowlist_excludes_secrets_and_matches_owned_sockets(self):
        data = {"inbounds": [{"type": "vless", "tag": "vless-in", "listen_port": 443, "password": "never-export", "users": [{"uuid": "never-export", "flow": "xtls-rprx-vision"}], "tls": {"enabled": True, "reality": {"enabled": True, "private_key": "never-export"}}}]}
        records = inbound_records([data], {("tcp", 443)})
        self.assertEqual(records, [{"tag": "vless-in", "type": "vless", "listening": True, "securityProfile": "xtls-vision-reality"}])
        self.assertNotIn("never-export", json.dumps(records))
        self.assertFalse(inbound_records([data], {("udp", 443)})[0]["listening"])

    def test_probe_reads_only_process_owned_listening_sockets(self):
        with tempfile.TemporaryDirectory() as directory:
            process = Path(directory)
            (process / "net").mkdir()
            for name in ("tcp", "tcp6", "udp", "udp6"):
                (process / "net" / name).write_text("header\n" + ("0: 00000000:01BB 00000000:0000 0A 0:0 0:0 0 0 0 123\n1: 00000000:01BB 00000000:0000 0A 0:0 0:0 0 0 0 999\n2: 00000000:01BC 00000000:0000 01 0:0 0:0 0 0 0 123\n" if name == "tcp" else ""))
            with patch("castoriceui.protocol_probe.Path.iterdir", return_value=[process / "fd" / "3"]), patch("castoriceui.protocol_probe.os.readlink", return_value="socket:[123]"):
                self.assertEqual(owned_listeners(process), {("tcp", 443)})

    def test_probe_resolves_config_directory_and_multiple_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.json").write_text("{}")
            (root / "b.json").write_text("{}")
            self.assertEqual(config_paths(["sing-box", "run", "-C", directory], root), [root / "a.json", root / "b.json"])
            self.assertEqual(config_paths(["sing-box", "run", "--config=a.json", "-c", "b.json"], root), [root / "a.json", root / "b.json"])


if __name__ == "__main__":
    unittest.main()
