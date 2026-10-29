"""Audit counterexamples through real HTTP/SQLite, without production writes."""
from datetime import datetime, timezone
import http.client
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import test_v51_regressions as v51
from castoriceui.api import ApiServer
from castoriceui.dashboard import DashboardService
from castoriceui.security import normalize_https_image_url
from castoriceui.storage import Storage


class AuditFixes(v51.IsolatedState):
    def setUp(self):
        super().setUp()
        self.user_id = self.storage.create_initial_user('qa-admin', 'Synthetic-Original-Password-123!')
        self.token, self.csrf, _ = self.storage.create_session(self.user_id, 3600)
        self.server = ApiServer(self.config, self.storage, self.dashboard)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.now = datetime.now(timezone.utc).isoformat()
        self.host = {'observedAt': self.now, 'kernel': 'Synthetic Linux', 'memoryTotalBytes': 1024**3,
                     'databaseWritable': True, 'databaseBytes': 4096, 'trafficUsedBytes': 0,
                     'trafficLimitBytes': 10**12, 'cpuCores': 1, 'load': [0, 0, 0],
                     'uptimeSeconds': 60, 'nodeName': 'Synthetic', 'diskPercent': 50}
        self.dashboard.system_cache = self.host
        self.dashboard.runtime_cache['observedAt'] = self.now
        for key in ('system', 'runtime', 'network', 'subscriptions'):
            self.dashboard._collection_result(key, observed_at=self.now)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3)
        super().tearDown()

    def request(self, path, payload=None, method=None):
        headers = {'Content-Type': 'application/json', 'X-CastoriceUI-Request': '1',
                   'Cookie': 'castorice_session=' + self.token, 'X-CSRF-Token': self.csrf}
        client = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        try:
            client.request(method or ('PUT' if payload is not None else 'GET'), path,
                           json.dumps(payload) if payload is not None else None, headers)
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def test_capacity_threshold_and_history_have_stable_time_and_can_acknowledge(self):
        for percent, attention, expected in ((89.9, False, False), (90, False, True), (91, False, True), (50, True, True)):
            with self.subTest(percent=percent, attention=attention):
                self.host.update(diskPercent=percent, alertCapacity={'requiresAttention': attention})
                alerts = self.dashboard.alerts(self.host, [], [], [])
                self.dashboard.runtime_cache['alerts'] = alerts
                status, body = self.request('/api/v2/dashboard')
                self.assertEqual(status, 200)
                capacity = [a for a in body['alerts'] if a['id'] == 'storage-capacity']
                self.assertEqual(bool(capacity), expected)
                if expected:
                    self.assertEqual(capacity[0]['time'], capacity[0]['startedAt'])
                    first = capacity[0]['time']
                    again = self.dashboard.alerts(self.host, [], [], [])
                    self.assertEqual(next(a for a in again if a['id'] == 'storage-capacity')['time'], first)
        # A legacy record's missing field is repaired at projection, preserving stored bytes.
        with self.storage.connect() as connection:
            row = connection.execute("SELECT episode_id,payload_json FROM alert_history WHERE alert_id='storage-capacity' LIMIT 1").fetchone()
            payload = json.loads(row['payload_json']); payload.pop('time', None)
            raw = json.dumps(payload)
            connection.execute('UPDATE alert_history SET payload_json=? WHERE episode_id=?', (raw, row['episode_id']))
        status, page = self.request('/api/v2/alerts?filter=all')
        self.assertEqual(status, 200)
        legacy = next(a for a in page['items'] if a['episodeId'] == row['episode_id'])
        self.assertEqual(legacy['time'], legacy['startedAt'])
        status, _ = self.request('/api/v2/alerts/' + row['episode_id'] + '/ack', {}, 'POST')
        self.assertEqual(status, 200)
        with self.storage.connect() as connection:
            self.assertEqual(connection.execute('SELECT payload_json FROM alert_history WHERE episode_id=?', (row['episode_id'],)).fetchone()[0], raw)

    def test_capacity_diagnostics_fail_independently_then_recover_over_http(self):
        collector = self.dashboard.system_collector
        original_read = Path.read_text
        def reading(path, *args, **kwargs):
            return '3600 0' if path.as_posix() == '/proc/uptime' else original_read(path, *args, **kwargs)
        for target in ('size', 'archive', 'recovered'):
            with self.subTest(target=target), patch.object(collector, 'cpu_percent', return_value=12), patch.object(collector, 'memory', return_value=(2_000_000_000, 800_000_000, 40)), patch.object(collector, 'network', return_value=(10000, 20000, 100, 200)), patch('castoriceui.collectors.os.getloadavg', return_value=(.1, .2, .3), create=True), patch.object(Path, 'read_text', reading):
                with patch.object(self.storage, 'database_size', side_effect=OSError() if target == 'size' else None, return_value=4096), patch('castoriceui.alert_archive.capacity', side_effect=OSError() if target == 'archive' else None, return_value={}):
                    self.dashboard.system_cache = self.dashboard.collect_system_snapshot()
                status, body = self.request('/api/v2/dashboard')
                self.assertEqual(status, 200)
                self.assertTrue(body['overview']['databaseWritable'])
                self.assertEqual(body['overview']['cpuPercent'], 12)
                self.assertEqual(body['overview']['databaseBytes'], 4096 if target == 'recovered' else None)
        with self.storage.connect() as connection:
            self.assertGreater(connection.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 0)

    def test_connection_sources_and_freshness_matrix(self):
        for hy, sb, hy_ok, sb_ok, expected in (
            (True, False, True, False, 'ready'), (False, True, False, True, 'ready'),
            (True, True, True, True, 'ready'), (True, True, True, False, 'partial'),
            (True, True, False, True, 'partial'), (True, True, False, False, 'error'),
            (False, False, False, False, 'pending'),
        ):
            with self.subTest(hy=hy, sb=sb, hy_ok=hy_ok, sb_ok=sb_ok):
                self.config.hysteria_api = {'url': 'http://127.0.0.1:19090' if hy else ''}
                self.config.singbox_api = {'url': 'http://127.0.0.1:19091' if sb else ''}
                hy2 = {'available': hy_ok, 'endpointStatus': {'streams': hy_ok}, 'traffic': {}, 'online': {}}
                singbox = {'available': sb_ok, 'connections': [], 'traffic': {}, 'inventory': {}}
                self.dashboard.runtime_cache.update(hy2=hy2, singbox=singbox)
                for name, ok in (('hysteria2', hy_ok), ('singbox', sb_ok)):
                    self.dashboard._collection_result(name, observed_at=self.now, error=None if ok else 'adapter_unavailable')
                self.dashboard.runtime_cache['integrations'] = self.dashboard.runtime_integrations(hy2, singbox, [], self.host, {'configured': False, 'ready': False, 'count': 0})
                status, body = self.request('/api/v2/dashboard')
                self.assertEqual(status, 200)
                state = next(i for i in body['integrations'] if i['id'] == 'connections')
                self.assertEqual(state['status'], expected)
                self.assertEqual(len(state['sources']), int(hy) + int(sb))
        self.config.hysteria_api = {'url': 'http://127.0.0.1:19090'}
        state = {}
        self.dashboard.connection_integration(state, {'available': True}, {}, {'hysteria2': {'status': 'stale'}})
        self.assertEqual(state['status'], 'error')

    def test_pending_protocol_edit_survives_restart_and_legacy_node_rules_are_retired(self):
        target = {'name': 'Synthetic DNS', 'address': '2606:4700:4700::1111', 'ipVersion': 6,
                  'order': 1, 'latencyMs': 321, 'lossPercent': 7, 'tcpPort': 443, 'dnsPort': 53, 'dnsName': 'example.com'}
        self.assertEqual(self.request('/api/v2/settings/network-targets', {'targets': [target]})[0], 200)
        pending = self.request('/api/v2/dashboard')[1]['networkTargets'][0]
        self.assertNotIn('thresholdOverrides', pending)
        editor = {key: pending[key] for key in ('name', 'address', 'ipVersion', 'order', 'tcpPort', 'dnsPort', 'dnsName')}
        editor.update(name='Renamed', order=2)
        self.assertEqual(self.request('/api/v2/settings/network-targets', {'targets': [editor]})[0], 200)
        fresh = DashboardService(self.config, Storage(self.config.database_path))
        saved = fresh.config.network_targets[0]
        for key in ('tcpPort', 'dnsPort', 'dnsName', 'address'):
            self.assertEqual(saved[key], target[key])
        self.assertNotIn('latencyMs', saved)
        editor.pop('tcpPort')
        self.assertEqual(self.request('/api/v2/settings/network-targets', {'targets': [editor]})[0], 200)
        fresh = DashboardService(self.config, Storage(self.config.database_path))
        self.assertNotIn('tcpPort', fresh.config.network_targets[0])
        self.assertEqual(fresh.config.network_targets[0]['dnsPort'], 53)

    def test_new_network_rules_are_visible_before_cached_measurements_refresh(self):
        self.dashboard.runtime_cache['integrations'] = self.config.public_integrations()
        previous = next(item for item in self.dashboard.runtime_cache['integrations'] if item['id'] == 'alerts')
        previous['values'] = {'latencyMs': '150', 'lossPercent': '5', 'trafficPercent': '80'}
        target = {'name': 'Test DNS', 'address': '1.1.1.1'}
        self.assertEqual(self.request('/api/v2/settings/network-targets', {'targets': [target], 'globalThresholds': {'latencyMs': 240, 'lossPercent': 8}})[0], 200)
        status, body = self.request('/api/v2/dashboard')
        self.assertEqual(status, 200)
        actual = next(item for item in body['integrations'] if item['id'] == 'alerts')['values']
        self.assertEqual(float(actual['latencyMs']), 240)
        self.assertEqual(float(actual['lossPercent']), 8)
        self.assertEqual(float(actual['trafficPercent']), 80)
        self.assertEqual(previous['values']['latencyMs'], '150')

    def test_invalid_background_ports_do_not_change_saved_appearance(self):
        original = {'type': 'url', 'value': 'https://images.example.com/image', 'fit': 'cover', 'cacheSeconds': 0, 'glass': 'default', 'glassEnabled': False}
        self.storage.set_setting('login_background', original)
        for port in ('', 'letters', '0', '65536', '-1'):
            with self.subTest(port=port):
                payload = {**original, 'value': 'https://images.example.com:' + port + '/random'}
                status, body = self.request('/api/v2/settings/login-background', payload)
                self.assertEqual(status, 400)
                self.assertEqual(body['field'], 'value')
                self.assertEqual(body['error'], 'invalid_background_port')
                self.assertEqual(self.storage.get_setting('login_background', {}), original)
        for url in ('https://images.example.com/image', 'https://images.example.com:443/image', 'https://images.example.com:8443/image', 'https://[2606:4700:4700::1111]:8443/image'):
            self.assertEqual(normalize_https_image_url(url), url)


if __name__ == '__main__':
    unittest.main()
