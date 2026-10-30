"""Regressions reproduced while rechecking the v4.7 and v5.0 requirements."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import importlib.util
import json
import time

from castoriceui.collectors import service_snapshots
from castoriceui.dashboard import DashboardService
from castoriceui.storage import Storage
import test_service_health as health
import test_v45_regressions as v45


class MonitoringReworkTests(unittest.TestCase):
    def test_day_history_preserves_maxima_gaps_family_and_query_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / 'qa.sqlite'))
            now = 1800000000
            for offset, latency, loss, complete, family in ((600, 10, 0, True, 4), (580, 900, 100, True, 4), (560, None, None, False, 4), (540, 1000, 50, True, 6)):
                storage.record_monitoring('network', 'qa', {'latency': latency, 'loss': loss, 'complete': complete, 'resolvedIpVersion': family, 'status': 'healthy'}, now-offset)
            result = storage.network_time_history('qa', 24, 4, now)
            self.assertEqual(result['sourceSamples'], 3)
            self.assertEqual(result['samples'][0]['latency'], 900)
            self.assertEqual(result['samples'][0]['loss'], 100)
            self.assertTrue(result['samples'][0]['hasGaps'])
            self.assertEqual(result['granularitySeconds'], 1440)
            with storage.connect() as connection:
                connection.executemany('INSERT INTO monitoring_samples(captured_at,domain,target,payload_json) VALUES(?,?,?,?)', [(now-20, 'network', 'bounded', json.dumps({'complete': True, 'ipVersion': 4, 'latency': 1, 'loss': 0}))] * 5002)
            bounded = storage.network_time_history('bounded', 24, 4, now)
            self.assertEqual(bounded['sourceSamples'], 5000)
            self.assertTrue(bounded['truncated'])
            with self.assertRaises(ValueError):
                storage.network_time_history('qa', 720, 4, now)

    def test_independent_hy2_outage_is_not_grouped_under_singbox(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / 'qa.sqlite'))
            dashboard = DashboardService(health.config(), storage)
            with patch('castoriceui.collectors.service_state', return_value=('failed', 0)), patch('castoriceui.collectors.run', return_value='1.13.19'):
                services = service_snapshots(health.config(), health.SYSTEM, {'available': False}, {'available': False, 'inventory': {}})
            alerts = {x['id']: x for x in dashboard.alerts({'trafficUsedBytes': 0, 'trafficLimitBytes': 100}, services, [])}
            self.assertIn('service-hysteria2', alerts)
            self.assertIn('service-singbox', alerts)
            self.assertNotIn('hysteria2', alerts['service-singbox']['affectedServices'])
            self.assertNotIn('singbox', alerts['service-singbox']['affectedServices'])

    def test_missing_listener_is_offline_even_when_statistics_api_is_down(self):
        inventory = health.inventory()
        inventory['inbounds'][0]['listening'] = False
        with patch('castoriceui.collectors.service_state', return_value=('active', 100)), patch('castoriceui.collectors.run', return_value='1.13.19'):
            services = service_snapshots(health.config(), health.SYSTEM, {'available': True}, {'available': False, 'inventory': inventory})
        service = next(item for item in services if item['id'] == 'anytls')
        self.assertEqual(service['status'], 'stopped')
        self.assertEqual(service['stateReason'], 'listener_missing')

    def test_statistics_uncertainty_does_not_resolve_a_core_outage(self):
        with tempfile.TemporaryDirectory() as folder:
            storage = Storage(str(Path(folder) / 'qa.sqlite'))
            dashboard = DashboardService(health.config(), storage)
            system = {'trafficUsedBytes': 0, 'trafficLimitBytes': 100}
            with patch('castoriceui.collectors.service_state', return_value=('failed', 0)), patch('castoriceui.collectors.run', return_value='1.13.19'):
                failed = service_snapshots(health.config(), health.SYSTEM, {'available': False}, {'available': False, 'inventory': {}})
            dashboard.alerts(system, failed, [])
            first = {item['id']: item['episodeId'] for item in storage.active_alerts()}
            with patch('castoriceui.collectors.service_state', return_value=('active', 100)), patch('castoriceui.collectors.run', return_value='1.13.19'):
                unknown = service_snapshots(health.config(), health.SYSTEM, {'available': False}, {'available': False, 'inventory': {}})
            dashboard.alerts(system, unknown, [])
            active = {item['id']: item for item in storage.active_alerts()}
            for key in ('service-singbox', 'service-hysteria2'):
                self.assertIn(key, set(active))
                self.assertEqual(active[key]['episodeId'], first[key])
                self.assertEqual(active[key]['reason'], 'recovery_unconfirmed')


class EvidenceHttpReworkTests(unittest.TestCase):
    setUp = v45.AuditRegressions.setUp
    tearDown = v45.AuditRegressions.tearDown
    start_api = v45.AuditRegressions.start_api
    call = v45.AuditRegressions.call
    initialize = v45.AuditRegressions.initialize

    def test_network_history_requires_session_known_target_and_bounded_range(self):
        self.start_api()
        path = '/api/v2/network/qa/history?hours=24&ipVersion=4'
        self.assertEqual(self.call('GET', path)[0], 401)
        self.initialize()
        self.dashboard.runtime_cache['network'] = [{'id': 'qa'}]
        self.storage.record_monitoring('network', 'qa', {'complete': True, 'ipVersion': 4, 'latency': 25, 'loss': 0}, int(time.time()) - 40)
        status, data = self.call('GET', path)
        self.assertEqual(status, 200)
        self.assertEqual(data['sourceSamples'], 1)
        self.assertEqual(self.call('GET', '/api/v2/network/missing/history?hours=24')[0], 404)
        self.assertEqual(self.call('GET', '/api/v2/network/qa/history?hours=720')[0], 400)

    def test_evidence_is_authenticated_episode_scoped_and_preserves_samples(self):
        self.start_api()
        path = '/api/v2/alerts/synthetic/evidence'
        self.assertEqual(self.call('GET', path)[0], 401)
        self.initialize()
        for loss in (10, 30, 15):
            episode = self.storage.reconcile_alerts([{'id': 'network-qa', 'severity': 'warning', 'title': 'Synthetic loss', 'description': 'Synthetic', 'evidence': {'loss': loss}}])['network-qa']['episodeId']
        self.storage.reconcile_alerts([])
        status, data = self.call('GET', f'/api/v2/alerts/{episode}/evidence')
        self.assertEqual(status, 200)
        self.assertEqual([data[k]['evidence']['loss'] for k in ('first', 'worst', 'last')], [10, 30, 15])
        self.assertEqual(self.call('GET', path)[0], 404)
        self.assertEqual(self.call('GET', '/api/v2/alerts/invalid/value/evidence')[0], 400)


class HtmlUpgradePolicyTests(unittest.TestCase):
    def test_upgrade_only_changes_html_policy_and_is_repeatable(self):
        spec = importlib.util.spec_from_file_location('rework_installer', Path(__file__).resolve().parents[2] / 'deploy/install_release.py')
        installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
        template = (Path(__file__).resolve().parents[2] / 'deploy/nginx.conf.example').read_text()
        legacy = template.replace('        etag off;\n', '').replace('        if_modified_since off;\n', '').replace('add_header Cache-Control "no-store" always;\n        add_header X-Content-Type-Options "nosniff" always;\n        add_header Strict-Transport-Security', 'add_header Cache-Control "no-cache" always;\n        add_header X-Content-Type-Options "nosniff" always;\n        add_header Strict-Transport-Security')
        updated = installer.protect_html_updates(legacy)
        self.assertEqual(installer.protect_html_updates(updated), updated)
        self.assertIn('etag off;', updated)
        self.assertIn('if_modified_since off;', updated)
        self.assertEqual(updated.count('expires 7d;'), 1)
        self.assertIn('add_header Cache-Control "public, immutable";', updated)
        self.assertEqual(legacy.split('location ^~ /api/')[1].split('location /')[0], updated.split('location ^~ /api/')[1].split('location /')[0])


if __name__ == '__main__':
    unittest.main()
