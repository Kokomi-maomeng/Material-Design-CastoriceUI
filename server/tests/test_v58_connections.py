"""Configuration-driven connections across the wizard, collector and sampled groups."""
import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.collectors import PROTOCOLS, connection_snapshots, connection_source_ip
from castoriceui.dashboard import DashboardService
from castoriceui.storage import Storage
from test_service_health import API, config


class ConfiguredConnections(unittest.TestCase):
    def test_wizard_custom_tags_survive_restart_and_collect_tcp_udp_for_every_protocol(self):
        for profile in ("standard", "xtls-vision", "reality", "xtls-vision-reality"):
            with self.subTest(profile=profile), tempfile.TemporaryDirectory() as directory:
                cfg = config()
                cfg.database_path = str(Path(directory) / "state.db")
                cfg.protocol_adapters = {}
                cfg.hysteria_api = {}
                store = Storage(cfg.database_path)
                dashboard = DashboardService(cfg, store)
                inbounds, flows = [], []
                for index, (key, (_label, _icon, kinds)) in enumerate(PROTOCOLS.items()):
                    tag = f"custom/region-{index}"
                    kind = "mixed" if key == "socks5" else sorted(kinds)[0]
                    inbounds.append({"tag": tag, "type": kind, "listening": True, "securityProfile": profile if key == "vless" else "standard"})
                    values = {"endpoint": cfg.singbox_api["url"], "inboundTags": tag}
                    if key == "vless":
                        values["securityProfile"] = profile
                    inventory = {"available": True, "apiPort": 19091, "inbounds": copy.deepcopy(inbounds)}
                    with patch("castoriceui.dashboard.http_json", return_value=API), patch("castoriceui.dashboard.read_protocol_inventory", return_value=inventory):
                        self.assertTrue(dashboard.configure_integration(key, {"values": values})["configured"])
                    for family, source in ((4, "192.0.2.9"), (6, "2001:db8::9")):
                        for network in ("tcp", "udp"):
                            flows.append({"id": f"{key}-{family}-{network}", "metadata": {"type": kind + "/" + tag, "network": network,
                                "sourceIP": source, "destinationIP": "2001:db8::10", "destinationPort": "443", "inboundUser": "qa-account"}, "upload": 100, "download": 200})
                # Rebuild config from persisted wizard settings, rather than using the candidate object.
                restarted = config()
                restarted.database_path = cfg.database_path
                restarted.protocol_adapters = {}
                dashboard = DashboardService(restarted, store)
                rows = connection_snapshots({}, {"connections": flows, "inventory": inventory}, restarted.protocol_adapters)
                self.assertEqual(len(rows), len(PROTOCOLS) * 4)
                self.assertEqual({row["ipVersion"] for row in rows}, {4, 6})
                self.assertTrue(all(row["account"] == "qa-account" and row["destination"] == "[2001:db8::10]:443" for row in rows))
                with patch("castoriceui.dashboard.time.monotonic", return_value=10):
                    dashboard.aggregate_connections(rows)
                with patch("castoriceui.dashboard.time.monotonic", return_value=15):
                    groups = dashboard.aggregate_connections([{**row, "uploadedBytes": 150, "downloadedBytes": 300} for row in rows])
                self.assertEqual(len(groups), len(PROTOCOLS) * 2)
                self.assertTrue(all(group["connections"] == 2 and group["uploadBps"] == 20 and group["downloadBps"] == 40 for group in groups))
                self.assertTrue(all(group["sourceIp"] and len(group["details"]) == 2 for group in groups))
                self.assertIn("VLESS" + {"standard": "", "xtls-vision": " · XTLS Vision", "reality": " · Reality", "xtls-vision-reality": " · XTLS Vision · Reality"}[profile], {group["protocol"] for group in groups})

    def test_missing_identity_is_not_replaced_with_inbound_name_and_bad_mappings_are_excluded(self):
        flow = {"id": "qa", "metadata": {"inbound": "custom", "inboundName": "listener-name", "sourceIP": "::1", "host": "destination.example.test", "destinationPort": 8443}, "upload": 0, "download": 0}
        adapters = {"trojan": {"inboundTags": ["custom"]}}
        state = {"connections": [flow], "inventory": {"available": True, "inbounds": [{"tag": "custom", "type": "trojan"}]}}
        row = connection_snapshots({}, state, adapters)[0]
        self.assertEqual((row["account"], row["sourceIp"], row["ipVersion"], row["destination"]), ("", "::1", 6, "destination.example.test:8443"))
        for metadata in ({"inbound": "unknown"}, {"inbound": "custom", "type": "trojan/other"}, {"inbound": "custom", "type": "vmess/custom"}):
            self.assertEqual(connection_snapshots({}, {**state, "connections": [{**flow, "metadata": metadata}]}, adapters), [])
        state["inventory"]["inbounds"][0]["type"] = "vmess"
        self.assertEqual(connection_snapshots({}, state, adapters), [])
        self.assertEqual(connection_snapshots({}, {"connections": [flow]}, {**adapters, "vmess": {"inboundTags": ["CUSTOM"]}}), [])

    def test_source_parsing_accepts_compressed_ipv6_and_never_extracts_addresses_from_arbitrary_text(self):
        for raw, expected in (("::1", "::1"), ("[2001:db8::1]:1234", "2001:db8::1"), ("192.0.2.1:1234", "192.0.2.1"),
                              ("999.1.2.3", ""), ("notes: 192.0.2.1", ""), ("192.0.2.1:invalid", ""), (None, "")):
            with self.subTest(raw=raw):
                self.assertEqual(connection_source_ip(raw), expected)
        for raw in (None, "::1", "[2001:db8::1]:1234"):
            streams = {"streams": [{"auth": "qa-account", "source": raw, "req_addr": "[2001:db8::2]:443", "tx": 0, "rx": 0}]}
            row = connection_snapshots(streams, {})[0]
            self.assertEqual(row["sourceIp"], connection_source_ip(raw))
            self.assertEqual(row["destination"], "[2001:db8::2]:443")
