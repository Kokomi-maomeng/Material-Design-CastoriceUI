from __future__ import annotations

import json
import http.cookiejar
import copy
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, call, patch

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.collectors import automatic_update_info, billing_cycle_start, connection_snapshots, detect_interface, http_json, hysteria_snapshot, semantic_version, service_snapshots, singbox_snapshot, traffic_quota_period  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
from castoriceui.api import ApiHandler, ApiServer, normalized_origin  # noqa: E402
from castoriceui.security import _public_https_get, fetch_https_image_api, normalize_https_base_url, normalize_https_image_url, normalize_loopback_endpoint, probe_subscription_url, safe_background_image, validate_probe_target  # noqa: E402
from castoriceui.storage import Storage  # noqa: E402


class BackendTests(unittest.TestCase):
    def test_service_versions_ignore_terminal_control_sequences(self) -> None:
        self.assertEqual(semantic_version("\x1b[2JHysteria2 v2.11.0\x1b[0m", "hysteria2"), "2.11.0")
        self.assertEqual(semantic_version("sing-box version 1.13.15", "singbox"), "1.13.15")
        self.assertEqual(semantic_version("nginx version: nginx/1.26.3", "nginx"), "1.26.3")

    def test_automatic_update_status_comes_from_systemd(self) -> None:
        with patch("castoriceui.collectors.run_status", side_effect=["disabled", "inactive"]), patch("castoriceui.collectors.operating_system_version", return_value="Debian GNU/Linux 13"):
            state = automatic_update_info()
        self.assertEqual(state["status"], "warning")
        self.assertIn("disabled", state["detail"])
        self.assertEqual(state["version"], "Debian GNU/Linux 13")

    def test_connection_source_is_not_mislabelled_when_core_omits_it(self) -> None:
        payload = connection_snapshots(
            {"streams": [{"connection": "a", "stream": "b", "auth": "alice", "tx": 1, "rx": 2}]},
            {"connections": [{"id": "c", "metadata": {"user": "bob"}}]},
        )
        self.assertEqual(payload[0]["account"], "alice")
        self.assertEqual(payload[0]["sourceIp"], "")
        self.assertIsNone(payload[0]["ipVersion"])
        self.assertIsNone(payload[0]["uploadBps"])
        self.assertIsNone(payload[0]["downloadBps"])
        self.assertIsNone(payload[0]["connectedAt"])
        self.assertEqual(len(payload), 1, "untagged sing-box connections must remain hidden")

    def test_unmapped_hysteria_identity_is_not_assigned_to_an_account(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            dashboard = DashboardService(config, Storage(config.database_path))
            accounts = [{"id": "display-id", "name": "Display name"}]
            mapped = dashboard.account_metrics(accounts, {"traffic": {"protocol-user": {"tx": 7, "rx": 5}}, "online": {"protocol-user": 2}}, 400)
            self.assertEqual(mapped[0]["usedBytes"], 0)
            self.assertEqual(mapped[0]["onlineDevices"], 0)
            ambiguous = dashboard.account_metrics([{"id": "a", "name": "A"}, {"id": "b", "name": "B"}], {"traffic": {"u1": {"tx": 9, "rx": 0}, "u2": {"tx": 8, "rx": 0}}, "online": {}}, 17)
            self.assertEqual([item["usedBytes"] for item in ambiguous], [0, 0])

    def test_explicit_hysteria_identity_mapping_supports_multiple_accounts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            dashboard = DashboardService(config, Storage(config.database_path))
            accounts = [{"id": "a", "name": "A", "trafficIdentities": {"hysteria2": ["u1"]}}, {"id": "b", "name": "B", "trafficIdentities": ["u2"]}]
            mapped = dashboard.account_metrics(accounts, {"traffic": {"u1": {"tx": 9, "rx": 1}, "u2": {"tx": 8, "rx": 2}}, "online": {"u1": 1, "u2": 3}}, 400)
            self.assertEqual([(item["usedBytes"], item["onlineDevices"]) for item in mapped], [(10, 1), (10, 3)])

    def test_single_explicit_owner_uses_the_unified_durable_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            dashboard = DashboardService(config, Storage(config.database_path))
            accounts = [{"id": "primary", "name": "primary", "trafficIdentities": {"hysteria2": ["user"]}}]
            mapped = dashboard.account_metrics(accounts, {"traffic": {"user": {"tx": 90, "rx": 10}}, "online": {"user": 3}}, 532)
            self.assertEqual(mapped[0]["usedBytes"], 532)
            self.assertEqual(mapped[0]["usageSource"], "durableLedger")
            self.assertEqual(mapped[0]["onlineDevices"], 3)

    def test_protocol_breakdowns_preserve_observed_counters_and_only_add_a_remainder(self) -> None:
        allocated = DashboardService.reconcile_breakdown([
            {"name": "Hysteria2", "value": 200},
            {"name": "AnyTLS", "value": 100},
        ], 400, "Unattributed")
        self.assertEqual(sum(item["value"] for item in allocated), 400)
        self.assertEqual([item["value"] for item in allocated], [200, 100, 100])
        observed = DashboardService.reconcile_breakdown([
            {"name": "Hysteria2", "value": 200},
            {"name": "AnyTLS", "value": 100},
        ], 100, "Unattributed")
        self.assertEqual([item["value"] for item in observed], [200, 100])
        self.assertEqual(DashboardService.reconcile_breakdown([], 400, "Unattributed"), [{"name": "Unattributed", "value": 400}])

    def test_invalid_configured_interface_falls_back_to_a_real_detected_interface(self) -> None:
        with patch("castoriceui.collectors.interface_has_counters", side_effect=lambda name: name == "ens3"), patch("castoriceui.collectors.run", return_value="default via 192.0.2.1 dev ens3"):
            self.assertEqual(detect_interface("eth0"), "ens3")
            self.assertEqual(detect_interface("ens3"), "ens3")
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"), interface="eth0")
            dashboard = DashboardService(config, Storage(config.database_path))
            with patch("castoriceui.collectors.detect_interface", return_value="ens3"):
                dashboard._apply_integration_values("traffic", {"interface": ""})
            self.assertEqual(config.interface, "")
            self.assertEqual(dashboard.system_collector.interface, "ens3")

    def test_optional_proxy_services_are_hidden_and_singbox_is_not_labelled_anytls(self) -> None:
        system = {"cpuCores": 2, "load": [0.1], "kernel": "6.12", "uptimeSeconds": 60}
        with patch("castoriceui.collectors.service_state", return_value=("active", 60)), patch("castoriceui.collectors.run", return_value="nginx version: nginx/1.26.3"), patch("castoriceui.collectors.certificate_info", return_value={"status": "warning", "detail": "not configured", "days": 0}):
            services = service_snapshots(AppConfig(), system, {"available": False}, {"available": False})
        self.assertEqual([item["id"] for item in services[:1]], ["nginx"])

        config = AppConfig(hysteria_api={"url": "http://127.0.0.1:19090"}, singbox_api={"url": "http://127.0.0.1:19091"}, protocol_adapters={"vless": {"inboundTags": ["vless-in"]}})
        with patch("castoriceui.collectors.service_state", return_value=("inactive", 0)), patch("castoriceui.collectors.run", return_value="sing-box version 1.13.15"), patch("castoriceui.collectors.certificate_info", return_value={"status": "warning", "detail": "not configured", "days": 0}):
            services = service_snapshots(config, system, {"available": True}, {"available": True})
        proxy_services = {item["id"]: item for item in services if item["id"] in {"hysteria2", "singbox"}}
        self.assertEqual(proxy_services["singbox"]["name"], "sing-box")
        self.assertEqual(proxy_services["singbox"]["status"], "warning")

    def test_connections_group_by_source_and_calculate_rates_from_consecutive_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            dashboard = DashboardService(config, Storage(config.database_path))
            raw = [
                {"id": "one", "protocol": "AnyTLS", "account": "user", "sourceIp": "203.0.113.1", "ipVersion": 4, "uploadedBytes": 100, "downloadedBytes": 200, "connectedAt": "2026-08-11T00:01:00Z", "destination": "one.test:443"},
                {"id": "two", "protocol": "AnyTLS", "account": "user", "sourceIp": "203.0.113.1", "ipVersion": 4, "uploadedBytes": 300, "downloadedBytes": 400, "connectedAt": "2026-08-11T00:00:00Z", "destination": "two.test:443"},
            ]
            with patch("castoriceui.dashboard.time.monotonic", side_effect=[10.0, 20.0]):
                first = dashboard.aggregate_connections(raw)
                updated = [{**item, "uploadedBytes": item["uploadedBytes"] + 100, "downloadedBytes": item["downloadedBytes"] + 200} for item in raw]
                second = dashboard.aggregate_connections(updated)
            self.assertEqual(len(first), 1)
            self.assertEqual(first[0]["connections"], 2)
            self.assertEqual(first[0]["connectedAt"], "2026-08-11T00:00:00Z")
            self.assertIsNone(first[0]["uploadBps"])
            self.assertEqual(second[0]["uploadBps"], 20)
            self.assertEqual(second[0]["downloadBps"], 40)
            self.assertEqual(len(second[0]["details"]), 2)

    def test_traffic_ranges_use_counter_deltas_and_do_not_merge_days_by_hour_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            storage = Storage(config.database_path)
            now = 2_000_000_000
            storage.record_sample(now - 600, 100, 200, 1, 1)
            storage.record_sample(now - 300, 160, 230, 1, 1)
            storage.record_sample(now, 210, 250, 1, 1)
            dashboard = DashboardService(config, storage)
            with patch("castoriceui.dashboard.time.time", return_value=now):
                traffic = dashboard.traffic_series()
            self.assertEqual(sum(item["download"] for item in traffic["ranges"]["1h"]), 110)
            self.assertEqual(sum(item["upload"] for item in traffic["ranges"]["1h"]), 50)
            self.assertEqual(set(traffic["ranges"]), {"1h", "6h", "24h", "3day", "7day"})
            self.assertGreaterEqual(len(traffic["ranges"]["1h"]), 2)
            self.assertEqual(traffic["ranges"]["1h"][-1]["capturedAt"], "2033-05-18T03:33:20Z")

    def test_traffic_ranges_never_subtract_counters_across_boots_or_interfaces(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            storage = Storage(config.database_path)
            now = 2_000_000_000
            storage.record_sample(now - 240, 100, 200, 1, 1, "eth0", "boot-a")
            storage.record_sample(now - 180, 160, 230, 1, 1, "eth0", "boot-a")
            storage.record_sample(now - 120, 10_000, 20_000, 1, 1, "eth0", "boot-b")
            storage.record_sample(now - 60, 10_040, 20_050, 1, 1, "eth0", "boot-b")
            storage.record_sample(now - 30, 50_000, 60_000, 1, 1, "ens3", "boot-b")
            storage.record_sample(now, 50_020, 60_030, 1, 1, "ens3", "boot-b")
            dashboard = DashboardService(config, storage)
            with patch("castoriceui.dashboard.time.time", return_value=now):
                traffic = dashboard.traffic_series()["ranges"]["1h"]
            self.assertEqual(sum(item["download"] for item in traffic), 120)
            self.assertEqual(sum(item["upload"] for item in traffic), 110)

    def test_named_network_targets_and_node_name_are_validated_and_saved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            dashboard.configure_integration("network", {"values": {"targets": "Cloudflare,1.1.1.1\n2606:4700:4700::1111"}})
            dashboard.configure_integration("system", {"values": {"nodeName": "Custom edge"}})
            self.assertEqual(config.network_targets[0]["name"], "Cloudflare")
            self.assertEqual(config.network_targets[1]["ipVersion"], 6)
            self.assertEqual(config.node_name, "Custom edge")

    def test_structured_network_targets_validate_order_and_persist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            saved = dashboard.update_network_targets([
                {"name": "Second", "address": "8.8.8.8", "order": 20},
                {"name": "First", "address": "1.1.1.1", "order": 10},
            ], "127.0.0.1", "tester")
            self.assertEqual([item["name"] for item in saved], ["First", "Second"])
            self.assertEqual([item["order"] for item in saved], [1, 2])
            self.assertEqual(storage.get_setting("network_targets", [])[0]["address"], "1.1.1.1")
            with self.assertRaisesRegex(ValueError, "unique"):
                dashboard.update_network_targets([
                    {"name": "One", "address": "1.1.1.1", "order": 1},
                    {"name": "Duplicate", "address": "1.1.1.1", "order": 2},
                ], "127.0.0.1", "tester")

    def test_singbox_connections_use_explicit_protocol_tags_without_guessing(self) -> None:
        payload = connection_snapshots({}, {"connections": [
            {"id": "one", "metadata": {"inbound": "vless-in", "sourceIP": "203.0.113.7"}},
            {"id": "two", "metadata": {"inbound": "unknown", "sourceIP": "203.0.113.8"}},
        ]}, {"vless": {"inboundTags": ["vless-in"]}})
        self.assertEqual([item["protocol"] for item in payload], ["VLESS"])

    def test_vless_security_profile_is_reflected_without_inventing_a_protocol(self) -> None:
        payload = connection_snapshots({}, {"connections": [
            {"id": "one", "metadata": {"inbound": "reality-in", "sourceIP": "203.0.113.7"}},
        ]}, {"vless": {"inboundTags": ["reality-in"], "securityProfile": "xtls-vision-reality"}})
        self.assertEqual(payload[0]["protocol"], "VLESS · XTLS Vision · Reality")

    def test_configured_adapter_is_unavailable_when_requests_fail(self) -> None:
        config = AppConfig(hysteria_api={"url": "http://127.0.0.1:19090"}, singbox_api={"url": "http://127.0.0.1:19091"})
        with patch("castoriceui.collectors.http_json", return_value=None):
            self.assertFalse(hysteria_snapshot(config)["available"])
            self.assertFalse(singbox_snapshot(config)["available"])

    def test_hysteria_adapter_is_not_healthy_when_an_expected_endpoint_fails(self) -> None:
        config = AppConfig(hysteria_api={"url": "http://127.0.0.1:19090"})
        def response(url: str, _secret: str = "") -> dict[str, object] | None:
            return None if url.endswith("/dump/streams") else {}

        with patch("castoriceui.collectors.http_json", side_effect=response):
            snapshot = hysteria_snapshot(config)
        self.assertFalse(snapshot["available"])
        self.assertEqual(snapshot["endpointStatus"], {"traffic": True, "online": True, "streams": False})

    def test_runtime_integration_status_separates_config_from_health(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"url": "http://127.0.0.1:19090"}
            config.subscriptions = [{"id": "sub-1", "account": "alice", "url": "https://example.test/token"}]
            dashboard = DashboardService(config, Storage(config.database_path))
            states = {item["id"]: item for item in dashboard.runtime_integrations({"available": False}, {"available": False}, [], subscription_probe={"configured": True, "ready": False, "count": 1})}
            self.assertTrue(states["hysteria2"]["configured"])
            self.assertEqual(states["hysteria2"]["status"], "error")
            self.assertEqual(states["connections"]["status"], "error")
            self.assertEqual(states["subscriptions"]["status"], "error")
            self.assertIn("did not pass", states["subscriptions"]["summary"])
            self.assertEqual(states["system"]["status"], "error")

    def test_runtime_integration_values_reopen_with_effective_non_secret_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.node_name = "Tokyo edge"
            config.hysteria_api = {"url": "http://127.0.0.1:19090", "secret": "protected"}
            config.managed_accounts = [{"id": "primary", "name": "primary", "trafficIdentities": {"hysteria2": ["user"]}}]
            dashboard = DashboardService(config, Storage(config.database_path))
            states = {item["id"]: item for item in dashboard.runtime_integrations({"available": True, "traffic": {"user": {}}, "online": {"user": 1}}, {"available": False}, [])}
            self.assertEqual(states["system"]["values"]["nodeName"], "Tokyo edge")
            self.assertEqual(states["hysteria2"]["values"], {"endpoint": "http://127.0.0.1:19090", "identityMappings": "primary=user"})
            self.assertNotIn("secret", states["hysteria2"]["values"])

    def test_configured_subscription_can_be_revalidated_without_returning_its_address(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.subscription_base_url = "https://example.test/subscription"
            config.subscriptions = [{"id": "sub-1", "account": "primary", "url": "https://example.test/protected"}]
            dashboard = DashboardService(config, Storage(config.database_path))
            with patch.object(dashboard, "subscription_probe", return_value={"configured": True, "ready": True, "count": 1}) as probe:
                result = dashboard.configure_integration("subscriptions", {"values": {}})
            self.assertTrue(result["configured"])
            self.assertNotIn("values", result)
            probe.assert_called_once_with("https://example.test/subscription", force=True)

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
            self.assertEqual(storage.audit_page()["items"][0]["detail"], "safe detail")

    def test_traffic_usage_survives_reboot_counter_reset_and_interface_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            storage.record_sample(100, 100, 200, 0, 0, "eth0", "boot-a")
            storage.record_sample(160, 160, 230, 0, 0, "eth0", "boot-a")
            storage.record_sample(220, 10, 20, 0, 0, "eth0", "boot-b")
            storage.record_sample(280, 50, 50, 0, 0, "eth0", "boot-b")
            storage.record_sample(340, 5, 7, 0, 0, "ens3", "boot-b")
            storage.record_sample(400, 25, 37, 0, 0, "ens3", "boot-b")
            usage = storage.traffic_usage_since(100, "sum")
            self.assertEqual(usage["receivedBytes"], 120)
            self.assertEqual(usage["transmittedBytes"], 90)
            self.assertEqual(usage["usedBytes"], 210)
            self.assertEqual(storage.traffic_usage_since(100, "max")["usedBytes"], 120)

    def test_mid_cycle_baseline_is_explicit_and_scoped_by_caller(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            storage.record_sample(500, 10, 20, 0, 0, "eth0", "boot")
            storage.record_sample(560, 30, 50, 0, 0, "eth0", "boot")
            without_baseline = storage.traffic_usage_since(100, "sum")
            with_baseline = storage.traffic_usage_since(100, "sum", 1_000_000_000)
            self.assertEqual(with_baseline["usedBytes"], without_baseline["usedBytes"] + 1_000_000_000)

    def test_saved_traffic_baseline_keeps_its_original_cycle_on_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "state.db")
            config = AppConfig(database_path=path)
            config.integrations = AppConfig.load(self._config_file(directory, path)).integrations
            storage = Storage(path)
            dashboard = DashboardService(config, storage)
            dashboard.configure_integration("traffic", {"values": {"quotaGb": "1000", "billingDay": "1", "billingTimezone": "UTC", "initialUsedGb": "12", "countMode": "sum"}})
            saved_cycle = storage.get_setting("integration_overrides", {})["traffic"]["values"]["initialUsedCycle"]
            restarted = AppConfig(database_path=path)
            restarted.integrations = AppConfig.load(self._config_file(directory, path)).integrations
            DashboardService(restarted, storage)
            self.assertEqual(restarted.traffic_initial_used_cycle, saved_cycle)
            self.assertEqual(restarted.traffic_initial_used_bytes, 12_000_000_000)

    def test_audit_records_are_filtered_and_paginated_on_the_server(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            for index in range(75):
                storage.add_audit(
                    f"action-{index}",
                    "认证" if index % 2 else "系统",
                    f"detail-{index}",
                    actor="operator",
                )
            first = storage.audit_page(page=1, page_size=30)
            second = storage.audit_page(page=2, page_size=50)
            filtered = storage.audit_page(page=1, page_size=50, search="detail-7", category="认证")
            self.assertEqual((len(first["items"]), first["total"], first["totalPages"]), (30, 75, 3))
            self.assertEqual((len(second["items"]), second["page"], second["totalPages"]), (25, 2, 2))
            self.assertTrue(filtered["items"])
            self.assertTrue(all(item["category"] == "认证" and "detail-7" in item["detail"] for item in filtered["items"]))

    def test_alert_acknowledgement_is_scoped_to_one_active_episode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            first = storage.reconcile_alerts(["service-nginx"])["service-nginx"]
            self.assertFalse(first["acknowledged"])
            self.assertTrue(storage.acknowledge("service-nginx"))
            acknowledged = storage.reconcile_alerts(["service-nginx"])["service-nginx"]
            self.assertTrue(acknowledged["acknowledged"])
            self.assertEqual(acknowledged["episodeId"], first["episodeId"])
            storage.reconcile_alerts([])
            recurring = storage.reconcile_alerts(["service-nginx"])["service-nginx"]
            self.assertFalse(recurring["acknowledged"])
            self.assertNotEqual(recurring["episodeId"], first["episodeId"])
            self.assertFalse(storage.acknowledge("service-unknown"))

    def test_alerts_are_generated_from_live_backend_conditions_and_persist_acknowledgement(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            dashboard = DashboardService(AppConfig(database_path=storage.path), storage)
            system = {"trafficUsedBytes": 900, "trafficLimitBytes": 1000}
            services = [{"id": "nginx", "name": "Nginx", "status": "stopped", "detail": "offline"}]
            network = [{"id": "edge", "name": "Edge", "status": "down", "latency": 999, "loss": 100}]
            alerts = dashboard.alerts(system, services, network)
            self.assertEqual({item["id"] for item in alerts}, {"traffic-threshold", "service-nginx", "network-edge"})
            self.assertTrue(storage.acknowledge("service-nginx"))
            refreshed = dashboard.alerts(system, services, network)
            self.assertTrue(next(item for item in refreshed if item["id"] == "service-nginx")["acknowledged"])

    def test_configured_integration_failure_creates_an_alert(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            dashboard = DashboardService(AppConfig(database_path=storage.path), storage)
            alerts = dashboard.alerts(
                {"trafficUsedBytes": 0, "trafficLimitBytes": 1000},
                [],
                [],
                [{"id": "subscriptions", "configured": True, "status": "error", "summary": "probe failed", "summaryZh": "实际验证失败"}],
            )
            self.assertEqual(alerts[0]["id"], "integration-subscriptions")
            self.assertEqual(alerts[0]["titleZh"], "订阅配置需要检查")
            self.assertEqual(alerts[0]["sourceZh"], "数据接入验证")

    def test_quota_schedule_matches_day_week_month_year_and_disabled_modes(self) -> None:
        default_start, default_next, default_schedule = traffic_quota_period(
            datetime(2026, 8, 19, tzinfo=timezone.utc), {},
        )
        self.assertFalse(default_schedule["autoReset"])
        self.assertIsNone(default_next)
        self.assertLessEqual(default_start, datetime(2026, 8, 19, tzinfo=timezone.utc))
        monthly_start, monthly_next, _ = traffic_quota_period(
            datetime(2026, 3, 15, tzinfo=timezone.utc),
            {"autoReset": True, "periodUnit": "month", "periodCount": 1, "resetAnchor": "2026-01-31", "timezone": "UTC"},
        )
        self.assertEqual(monthly_start.date().isoformat(), "2026-02-28")
        self.assertEqual(monthly_next.date().isoformat(), "2026-03-31")
        weekly_start, weekly_next, _ = traffic_quota_period(
            datetime(2026, 1, 20, tzinfo=timezone.utc),
            {"autoReset": True, "periodUnit": "week", "periodCount": 2, "resetAnchor": "2026-01-05", "timezone": "UTC"},
        )
        self.assertEqual(weekly_start.date().isoformat(), "2026-01-19")
        self.assertEqual(weekly_next.date().isoformat(), "2026-02-02")
        yearly_start, yearly_next, _ = traffic_quota_period(
            datetime(2025, 8, 1, tzinfo=timezone.utc),
            {"autoReset": True, "periodUnit": "year", "periodCount": 1, "resetAnchor": "2024-02-29", "timezone": "UTC"},
        )
        self.assertEqual(yearly_start.date().isoformat(), "2025-02-28")
        self.assertEqual(yearly_next.date().isoformat(), "2026-02-28")
        with patch("castoriceui.collectors.ZoneInfo", return_value=timezone(timedelta(hours=9))):
            tokyo_start, tokyo_next, tokyo_schedule = traffic_quota_period(
                datetime(2026, 8, 25, 0, 0, tzinfo=timezone.utc),
                {"autoReset": True, "periodUnit": "day", "periodCount": 1, "resetAnchor": "2026-08-01", "resetTime": "03:00", "timezone": "Asia/Tokyo"},
            )
        self.assertEqual(tokyo_start.isoformat(), "2026-08-24T18:00:00+00:00")
        self.assertEqual(tokyo_next.isoformat(), "2026-08-25T18:00:00+00:00")
        self.assertEqual(tokyo_schedule["resetTime"], "03:00")
        fixed_start, fixed_next, normalized = traffic_quota_period(
            datetime(2026, 8, 19, tzinfo=timezone.utc),
            {"autoReset": False, "periodUnit": "day", "periodCount": 1, "resetAnchor": "2026-01-01", "fixedCycleStart": "2026-06-01T00:00:00Z", "timezone": "UTC"},
        )
        self.assertEqual(fixed_start.date().isoformat(), "2026-06-01")
        self.assertIsNone(fixed_next)
        self.assertFalse(normalized["autoReset"])

    def test_integration_is_ready_only_after_authenticated_probe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            config.integrations = AppConfig.load(
                self._config_file(directory, config.database_path)
            ).integrations
            config.hysteria_api = {"url": "http://127.0.0.1:19090", "secret": "unit-test-secret"}
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            with patch("castoriceui.dashboard.http_json", return_value={}) as probe:
                result = dashboard.configure_integration("hysteria2", {"enabled": True, "values": {"endpoint": "http://127.0.0.1:19090", "secret": "must-be-ignored"}})
            self.assertTrue(result["configured"])
            self.assertEqual(probe.call_args_list, [
                call("http://127.0.0.1:19090/traffic", "unit-test-secret", strict=True),
                call("http://127.0.0.1:19090/online", "unit-test-secret", strict=True),
                call("http://127.0.0.1:19090/dump/streams", "unit-test-secret", strict=True),
            ])
            self.assertNotIn("secret", json.dumps(result))
            self.assertNotIn("secret", json.dumps(storage.get_setting("integration_overrides", {})))

    def test_hysteria_setup_persists_explicit_identity_mapping_without_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"secret": "unit-test-secret"}
            config.managed_accounts = [{"id": "account-1", "name": "primary"}]
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            responses = [{"user": {"tx": 1, "rx": 2}}, {"user": 1}, {"streams": []}]
            with patch("castoriceui.dashboard.http_json", side_effect=responses):
                dashboard.configure_integration("hysteria2", {"values": {"endpoint": "http://127.0.0.1:19090", "identityMappings": "primary=user"}})
            self.assertEqual(config.managed_accounts[0]["trafficIdentities"], {"hysteria2": ["user"]})
            saved = storage.get_setting("integration_overrides", {})["hysteria2"]
            self.assertEqual(saved["values"]["identityMappings"], "primary=user")
            self.assertNotIn("unit-test-secret", json.dumps(saved))

    def test_non_loopback_or_failed_probe_is_not_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"secret": "unit-test-secret"}
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            with self.assertRaisesRegex(ValueError, "loopback"):
                dashboard.configure_integration("hysteria2", {"values": {"endpoint": "http://169.254.169.254/latest/meta-data"}})
            self.assertEqual(storage.get_setting("integration_overrides", {}), {})

            with self.assertRaisesRegex(ValueError, "interface"):
                dashboard.configure_integration("traffic", {"values": {"interface": "../../etc", "quotaGb": "10"}})
            with patch("castoriceui.dashboard.http_json", side_effect=ValueError("failed")):
                with self.assertRaisesRegex(ValueError, "failed"):
                    dashboard.configure_integration("hysteria2", {"values": {"endpoint": "http://127.0.0.1:19090"}})
            self.assertEqual(storage.get_setting("integration_overrides", {}), {})

    def test_legacy_sqlite_secret_is_removed_without_overwriting_server_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.hysteria_api = {"url": "http://127.0.0.1:19090", "secret": "protected-config-secret"}
            storage = Storage(config.database_path)
            storage.set_setting("integration_overrides", {"hysteria2": {"enabled": True, "configured": True, "values": {"endpoint": "http://127.0.0.1:19090", "secret": "legacy-plaintext"}}})
            DashboardService(config, storage)
            self.assertNotIn("secret", json.dumps(storage.get_setting("integration_overrides", {})))
            self.assertEqual(config.hysteria_api["secret"], "protected-config-secret")

    def test_legacy_non_loopback_endpoint_is_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            storage = Storage(config.database_path)
            storage.set_setting("integration_overrides", {"hysteria2": {"configured": True, "values": {"endpoint": "http://169.254.169.254/latest"}}})
            dashboard = DashboardService(config, storage)
            saved = storage.get_setting("integration_overrides", {})["hysteria2"]
            self.assertFalse(saved["configured"])
            self.assertNotIn("endpoint", saved["values"])
            self.assertNotIn("169.254.169.254", json.dumps(dashboard.config.hysteria_api))

    def test_url_and_probe_target_validation(self) -> None:
        self.assertEqual(normalize_loopback_endpoint("http://127.0.0.1:19090/"), "http://127.0.0.1:19090")
        self.assertEqual(normalize_loopback_endpoint("http://[::1]:19090"), "http://[::1]:19090")
        self.assertEqual(normalize_https_base_url("https://panel.example.com/subscription/"), "https://panel.example.com/subscription")
        self.assertEqual(validate_probe_target("2606:4700:4700::1111")[1], 6)
        with self.assertRaises(ValueError):
            normalize_loopback_endpoint("http://example.com:19090")
        with self.assertRaises(ValueError):
            normalize_https_base_url("http://panel.example.com/subscription")
        with self.assertRaises(ValueError):
            validate_probe_target("-f")
        self.assertEqual(normalize_https_image_url("https://images.example.test/panel.webp", ["images.example.test"]), "https://images.example.test/panel.webp")
        self.assertEqual(normalize_https_image_url("https://images.example.test/panel.webp?size=large"), "https://images.example.test/panel.webp?size=large")
        with self.assertRaisesRegex(ValueError, "allowlisted"):
            normalize_https_image_url("https://other.example.test/panel.webp", ["images.example.test"])
        with self.assertRaises(ValueError):
            normalize_https_image_url("http://127.0.0.1/private.png")
        with self.assertRaises(ValueError):
            normalize_https_image_url("https://user:secret@images.example.test/panel.webp")
        with self.assertRaisesRegex(ValueError, "public IP"):
            fetch_https_image_api("https://127.0.0.1/private.png")
        with patch("castoriceui.security._public_https_get", side_effect=OSError("offline")):
            with self.assertRaisesRegex(ValueError, "unreachable"):
                fetch_https_image_api("https://images.example.test/random")

    def test_subscription_probe_requires_a_nonempty_public_https_response(self) -> None:
        headers = MagicMock()
        headers.get.return_value = "4"
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, b"data")) as fetch:
            probe_subscription_url("https://subscriptions.example.test/path/token")
            self.assertNotIn("path/token", repr(fetch.call_args.args[1]))
            fetch.return_value = (200, headers, b"")
            with self.assertRaisesRegex(ValueError, "empty"):
                probe_subscription_url("https://subscriptions.example.test/path/token")

    def test_public_https_fetch_pins_the_validated_address(self) -> None:
        response = MagicMock()
        response.status = 200
        response.headers = MagicMock()
        response.read.return_value = b"ok"
        connection = MagicMock()
        connection.getresponse.return_value = response
        resolved = [(2, 1, 6, "", ("93.184.216.34", 443))]
        with patch("castoriceui.security.socket.getaddrinfo", return_value=resolved) as resolver, patch("castoriceui.security._PinnedHTTPSConnection", return_value=connection) as pinned:
            status, _, body = _public_https_get("https://example.com/resource", {"Accept": "text/plain"}, 16)
        self.assertEqual((status, body), (200, b"ok"))
        resolver.assert_called_once()
        pinned.assert_called_once_with("example.com", 443, "93.184.216.34", 8)

    def test_subscription_setup_probes_protected_url_without_persisting_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(self._config_file(directory, str(Path(directory) / "state.db")))
            config.subscriptions = [{"id": "sub", "account": "primary", "url": "https://subscriptions.example.test/private-token", "enabled": True}]
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            candidate = "https://subscriptions.example.test/subscription?token=one-time"
            with patch("castoriceui.dashboard.probe_subscription_url") as probe:
                result = dashboard.configure_integration("subscriptions", {"values": {"baseUrl": candidate}})
            self.assertEqual(result["status"], "ready")
            self.assertEqual([call.args[0] for call in probe.call_args_list], [candidate, "https://subscriptions.example.test/private-token"])
            self.assertNotIn("private-token", json.dumps(storage.get_setting("integration_overrides", {})))
            self.assertNotIn("one-time", json.dumps(storage.get_setting("integration_overrides", {})))

    def test_server_background_image_stays_in_allowed_directory_and_checks_magic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "valid.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"safe")
            image, mime = safe_background_image(root, "valid.png")
            self.assertEqual(image.name, "valid.png")
            self.assertEqual(mime, "image/png")
            with self.assertRaises(ValueError):
                safe_background_image(root, "../valid.png")
            (root / "fake.png").write_text("not an image", encoding="utf-8")
            with self.assertRaises(ValueError):
                safe_background_image(root, "fake.png")

    def test_mutations_require_custom_request_guard(self) -> None:
        handler = object.__new__(ApiHandler)
        handler.headers = {}
        handler.send_json = MagicMock()
        self.assertFalse(handler.require_mutation_header())
        handler.send_json.assert_called_once()
        handler.headers = {"X-CastoriceUI-Request": "1", "X-Real-IP": "203.0.113.42"}
        handler.client_address = ("127.0.0.1", 12345)
        self.assertTrue(handler.require_mutation_header())
        self.assertEqual(handler.source_ip(), "203.0.113.42")
        handler.headers = {"X-CastoriceUI-Request": "1", "Host": "panel.example.test", "Origin": "https://evil.example.test"}
        handler.send_json.reset_mock()
        self.assertFalse(handler.require_mutation_header())
        handler.send_json.assert_called_once()
        handler.headers = {
            "X-CastoriceUI-Request": "1",
            "Host": "127.0.0.1:8765",
            "Origin": "https://panel.example.test:2087",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "panel.example.test:2087",
            "X-Forwarded-Port": "2087",
        }
        handler.send_json.reset_mock()
        self.assertTrue(handler.require_mutation_header())
        self.assertEqual(normalized_origin("https", "panel.example.test:2087"), ("https", "panel.example.test", 2087))
        handler.headers["Origin"] = "https://panel.example.test"
        self.assertFalse(handler.require_mutation_header())

    def test_server_enforces_session_idle_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = Storage(str(Path(directory) / "state.db"))
            user_id = storage.create_initial_user("operator", "Valid-Password-123")
            token, _, _ = storage.create_session(user_id, 3600)
            with storage.connect() as connection:
                connection.execute("UPDATE sessions SET last_seen_at='2000-01-01T00:00:00+00:00'")
            self.assertIsNone(storage.session(token, idle_timeout_seconds=120))

    def test_application_login_initialization_session_csrf_and_logout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bootstrap_path = root / "bootstrap-token"
            bootstrap_path.write_text("one-time-bootstrap-token\n", encoding="utf-8")
            config = AppConfig(database_path=str(root / "state.db"), bootstrap_token_path=str(bootstrap_path), secure_cookies=False, listen_host="127.0.0.1", listen_port=0)
            storage = Storage(config.database_path)
            dashboard = MagicMock()
            dashboard.snapshot.return_value = {"mode": "live", "generatedAt": "2026-08-11T00:00:00+00:00"}
            dashboard.audit_page.return_value = {"items": [], "total": 0, "page": 1, "pageSize": 30, "totalPages": 1}
            server = ApiServer(config, storage, dashboard)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            cookies = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

            def call(path: str, method: str = "GET", payload: dict[str, object] | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, object]]:
                data = json.dumps(payload).encode() if payload is not None else None
                request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{path}", data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
                try:
                    with opener.open(request, timeout=5) as response:
                        return response.status, json.loads(response.read())
                except urllib.error.HTTPError as error:
                    return error.code, json.loads(error.read())

            try:
                status, state = call("/api/v2/bootstrap")
                self.assertEqual(status, 200)
                self.assertTrue(state["setupRequired"])
                status, _ = call("/api/v2/auth/initialize", "POST", {"bootstrapToken": "wrong", "username": "operator", "password": "Valid-Password-123"})
                self.assertEqual(status, 403)
                status, session = call("/api/v2/auth/initialize", "POST", {"bootstrapToken": "one-time-bootstrap-token", "username": "operator", "password": "Valid-Password-123"})
                self.assertEqual(status, 201)
                self.assertFalse(bootstrap_path.exists())
                csrf = str(session["csrfToken"])
                status, _ = call("/api/v2/dashboard")
                self.assertEqual(status, 200)
                dashboard.snapshot.side_effect = RuntimeError("collector failed")
                status, result = call("/api/v2/dashboard")
                self.assertEqual(status, 503)
                self.assertEqual(result["error"], "dashboard_unavailable")
                dashboard.snapshot.side_effect = None
                status, audits = call("/api/v2/audits?page=1&pageSize=30")
                self.assertEqual(status, 200)
                self.assertEqual(audits["total"], 0)
                dashboard.audit_page.assert_called_once_with(1, 30, "", "")
                status, _ = call("/api/v2/settings/traffic-limit", "PUT", {"bytes": 10_000_000_000}, {"X-CastoriceUI-Request": "1"})
                self.assertEqual(status, 403)
                guard = {"X-CastoriceUI-Request": "1", "X-CSRF-Token": csrf}
                status, result = call("/api/v2/settings/traffic-limit", "PUT", {"bytes": 10_000_000_000}, guard)
                self.assertEqual(status, 200)
                self.assertEqual(result["bytes"], 10_000_000_000)
                status, result = call("/api/v2/settings/traffic-limit", "PUT", {"bytes": 20_000_000_000, "autoReset": True, "periodUnit": "week", "periodCount": 2, "resetAnchor": "2026-08-17", "resetTime": "03:30", "timezone": "UTC"}, guard)
                self.assertEqual(status, 200)
                self.assertEqual((result["periodUnit"], result["periodCount"], result["resetAnchor"]), ("week", 2, "2026-08-17"))
                self.assertEqual(result["resetTime"], "03:30")
                self.assertEqual(storage.get_setting("traffic_quota", {})["periodUnit"], "week")
                status, settings = call("/api/v2/settings/ui", "PUT", {"panelTitle": "My VPS", "idleTimeoutMinutes": 10, "showSetup": False}, guard)
                self.assertEqual(status, 200)
                self.assertEqual(settings["panelTitle"], "My VPS")
                self.assertEqual(settings["idleTimeoutMinutes"], 10)
                self.assertFalse(settings["showSetup"])
                status, _ = call("/api/v2/settings/ui", "PUT", {"idleTimeoutMinutes": 3}, guard)
                self.assertEqual(status, 400)
                user_id, _ = storage.authenticate("operator", "Valid-Password-123") or (0, "")
                other_token, _, _ = storage.create_session(user_id, 3600)
                status, result = call("/api/v2/auth/change-password", "POST", {"currentPassword": "wrong", "newPassword": "New-Password-456!"}, guard)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"], "invalid_current_password")
                status, _ = call("/api/v2/auth/change-password", "POST", {"currentPassword": "Valid-Password-123", "newPassword": "New-Password-456!"}, guard)
                self.assertEqual(status, 200)
                self.assertIsNone(storage.authenticate("operator", "Valid-Password-123"))
                self.assertIsNotNone(storage.authenticate("operator", "New-Password-456!"))
                self.assertIsNone(storage.session(other_token))
                storage.reconcile_alerts(["service-nginx"])
                status, _ = call("/api/v2/alerts/service-nginx/ack", "POST", {}, guard)
                self.assertEqual(status, 200)
                status, _ = call("/api/v2/alerts/service-unknown/ack", "POST", {}, guard)
                self.assertEqual(status, 404)
                status, _ = call("/api/v2/auth/logout", "POST", {}, guard)
                self.assertEqual(status, 200)
                status, _ = call("/api/v2/auth/session")
                self.assertEqual(status, 401)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_strict_probe_authenticates_and_does_not_follow_redirects(self) -> None:
        class ProbeHandler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                return

            def do_GET(self) -> None:
                if self.path == "/traffic" and self.headers.get("Authorization") == "unit-test-secret":
                    body = b"{}"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "http://169.254.169.254/latest/meta-data")
                    self.end_headers()
                    return
                self.send_response(401)
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            self.assertEqual(http_json(base + "/traffic", "unit-test-secret", strict=True), {})
            with self.assertRaisesRegex(ValueError, "validation failed"):
                http_json(base + "/redirect", strict=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_authenticated_payload_shows_identity_while_subscription_secrets_stay_server_side(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"))
            config.redact_live_data = True
            config.subscriptions = [{"id": "sub-1", "account": "alice", "url": "https://example.test/subscription/private-token", "enabled": True}]
            storage = Storage(config.database_path)
            dashboard = DashboardService(config, storage)
            public = dashboard.public_subscriptions()
            self.assertNotIn("private-token", json.dumps(public))
            self.assertEqual(public[0]["account"], "alice")
            self.assertEqual(dashboard.subscription_url("sub-1"), "https://example.test/subscription/private-token")
            storage.add_audit("test", "系统", "detail", "203.0.113.42", actor="operator")
            event = dashboard.audit_page(1, 30)["items"][0]
            self.assertEqual(event["actor"], "operator")
            self.assertEqual(event["ip"], "203.0.113.42")

    def test_live_payload_can_show_authenticated_operator_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"), redact_live_data=False)
            config.subscriptions = [{"id": "sub-1", "account": "alice", "url": "https://example.test/subscription/private-token", "enabled": True}]
            dashboard = DashboardService(config, Storage(config.database_path))
            public = dashboard.public_subscriptions()
            self.assertEqual(public[0]["account"], "alice")
            self.assertNotIn("url", public[0])

    def test_dashboard_payload_uses_explicit_account_and_subscription_allowlists(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig(database_path=str(Path(directory) / "state.db"), redact_live_data=False)
            config.managed_accounts = [{"id": "a", "name": "Alice", "password": "must-not-leak", "nested": {"token": "hidden"}}]
            config.subscriptions = [{"id": "s", "account": "Alice", "url": "https://example.test/private", "secret": "must-not-leak", "nested": {"token": "hidden"}}]
            dashboard = DashboardService(config, Storage(config.database_path))
            accounts = dashboard.account_metrics(copy.deepcopy(config.managed_accounts), {"traffic": {}, "online": {}}, 0)
            subscriptions = dashboard.public_subscriptions()
            serialized = json.dumps({"accounts": accounts, "subscriptions": subscriptions})
            self.assertNotIn("password", serialized)
            self.assertNotIn("secret", serialized)
            self.assertNotIn("nested", serialized)
            self.assertNotIn("private", serialized)

    def test_loaded_config_rejects_unsafe_or_unknown_security_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cases = [
                {"database_path": str(root / "a.db"), "listen_host": "0.0.0.0"},
                {"database_path": str(root / "b.db"), "secure_cookies": False},
                {"database_path": str(root / "c.db"), "unexpected_secret": "value"},
                {"database_path": str(root / "d.db"), "hysteria_api": {"url": "http://169.254.169.254/latest"}},
                {"database_path": str(root / "e.db"), "protocol_adapters": {"vless": {"inboundTags": "vless-in"}}},
                {"database_path": str(root / "f.db"), "protocol_adapters": {"vless": {"inboundTags": ["same"]}, "trojan": {"inboundTags": ["SAME"]}}},
                {"database_path": str(root / "g.db"), "protocol_adapters": {"vless": {"inboundTags": [], "securityProfile": "made-up"}}},
            ]
            for index, payload in enumerate(cases):
                path = root / f"unsafe-{index}.json"
                path.write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaises(ValueError):
                    AppConfig.load(path)

    def test_login_failures_persist_across_storage_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "state.db")
            first = Storage(path)
            for _ in range(5):
                first.record_login_failure("203.0.113.10")
            self.assertFalse(Storage(path).login_allowed("203.0.113.10"))
            Storage(path).clear_login_failures("203.0.113.10")
            self.assertTrue(Storage(path).login_allowed("203.0.113.10"))

    @staticmethod
    def _config_file(directory: str, database: str) -> str:
        path = Path(directory) / "config.json"
        path.write_text(json.dumps({"database_path": database}), encoding="utf-8")
        return str(path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
