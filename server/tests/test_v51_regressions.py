"""Counterexamples from the v5.0.1 audit, using isolated state and real HTTP."""
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from email.message import Message
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.api import ApiServer, AuthenticationBusy
from castoriceui.alert_archive import archive, capacity, restore
from castoriceui.collectors import http_json
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.external_probe import accept, canonical, service_evidence
from castoriceui.nginx_site import panel_site
from castoriceui.storage import Storage
from castoriceui.monitoring import NetworkPolicy


class IsolatedState(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        config_path = self.root / 'config.json'
        config_path.write_text(json.dumps({'database_path': str(self.root / 'state.db'), 'bootstrap_token_path': str(self.root / 'bootstrap')}))
        self.config = AppConfig.load(config_path)
        self.config.listen_port = 0
        self.storage = Storage(self.config.database_path)
        self.dashboard = DashboardService(self.config, self.storage)

    def tearDown(self):
        self.temporary.cleanup()


class AuditRegressions(IsolatedState):
    def test_loopback_credentials_never_enter_environment_proxy(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.server.server_port)
                self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
            def log_message(self, *_args): pass
        target = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        proxy = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        for server in (target, proxy):
            threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            environment = {name: f'http://127.0.0.1:{proxy.server_port}' for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')}
            environment.update(NO_PROXY='', no_proxy='')
            with patch.dict(os.environ, environment):
                self.assertEqual(http_json(f'http://127.0.0.1:{target.server_port}/', 'synthetic-management-secret', strict=True), {})
            self.assertEqual(requests, [target.server_port])
        finally:
            for server in (target, proxy): server.shutdown(); server.server_close()

    def test_wizard_preserves_quota_plan_baseline_and_disabled_reset(self):
        for auto in (False, True):
            expected = self.dashboard.update_traffic_quota({'bytes': 2_000_000_000, 'autoReset': auto, 'periodUnit': 'day', 'periodCount': 2, 'resetAnchor': '2026-01-01', 'resetTime': '03:30', 'timezone': 'Asia/Tokyo', 'initialUsedGb': '0.5'})
            values = self.dashboard.runtime_integrations({}, {}, [], None, {'ready': False})
            traffic = next(item for item in values if item['id'] == 'traffic')
            self.dashboard.configure_integration('traffic', {'values': traffic['values']})
            self.assertEqual(self.dashboard.traffic_quota_state(), expected)
            self.dashboard.configure_integration('traffic', {'values': {'billingDay': '1', 'billingTimezone': 'UTC', 'initialUsedGb': '0', 'quotaGb': '1000'}})
            self.assertEqual(self.dashboard.traffic_quota_state(), expected)

    def test_both_target_editors_keep_identity_policy_and_restart_history(self):
        target = {'id': 'existing-legacy', 'name': 'Resolver', 'address': '192.0.2.10', 'ipVersion': 4, 'order': 1, 'tcpPort': 443, 'dnsPort': 53, 'dnsName': 'example.com', 'latencyMs': 900, 'lossPercent': 20}
        self.config.network_targets = [target]
        self.storage.record_monitoring('network', target['id'], {'latency': 12})
        self.dashboard.configure_integration('network', {'values': {'targets': 'Renamed,192.0.2.10'}})
        for key in ('id', 'tcpPort', 'dnsPort', 'dnsName', 'latencyMs', 'lossPercent', 'ipVersion'):
            self.assertEqual(self.config.network_targets[0][key], target[key])
        saved = self.dashboard.update_network_targets([{**self.config.network_targets[0], 'name': 'Again'}], '127.0.0.1', 'qa-operator')
        restarted = DashboardService(self.config, self.storage)
        self.assertEqual(saved[0]['id'], target['id'])
        self.assertEqual(restarted.config.network_targets[0]['id'], target['id'])
        self.assertTrue(self.storage.monitoring_history('network', target['id'], since=0))
        changed = self.dashboard.update_network_targets([{**saved[0], 'address': '192.0.2.11'}], '127.0.0.1', 'qa-operator')
        self.assertNotEqual(changed[0]['id'], target['id'])

    def test_healthy_subscriptions_share_budget_and_report_truncation(self):
        body = json.dumps({'proxies': [{'name': 'Synthetic', 'type': 'trojan', 'server': 'node.example.com', 'port': 443, 'password': 'synthetic-only'}]}).encode()
        headers = Message(); headers['Content-Type'] = 'application/json'
        def response(*_args):
            time.sleep(.015)
            return 200, headers, body
        for count in (5, 12, 50, 51):
            self.config.subscriptions = [{'url': f'https://publisher.example.com/{index}'} for index in range(count)]
            with patch('castoriceui.security._public_https_get_before', side_effect=response):
                result = self.dashboard.subscription_probe()
            self.assertEqual(result['checkedCount'], min(count, 50))
            self.assertEqual(result['parseable'], min(count, 50))
            self.assertEqual(result['ready'], count <= 50)
            self.assertEqual(result['unverifiedCount'], max(0, count - 50))
        from castoriceui.security import PublicFetchBusy
        # A changed fingerprint prevents the previous cached result hiding contention.
        self.config.subscriptions = [{'url': 'https://new.example.com/sub'}]
        with patch('castoriceui.dashboard.probe_subscription_url', side_effect=PublicFetchBusy('local budget')):
            result = self.dashboard.subscription_probe()
        self.assertTrue(result['partial'])
        self.assertEqual(result['checkedCount'], 0)

    def test_external_observers_only_require_assigned_protocols(self):
        self.config.external_probe_secret = 'synthetic-reporting-secret-32-characters'
        self.config.external_probe_agents = ['anytls-agent', 'hy2-agent']
        self.config.external_probe_protocols = {'anytls-agent': ['anytls'], 'hy2-agent': ['hysteria2']}
        for agent, protocols in self.config.external_probe_protocols.items():
            payload = {'agentId': agent, 'nonce': agent + '-nonce-1234567890123456', 'observedAt': int(time.time()), 'agentHealthy': True, 'protocols': {protocols[0]: {'status': 'passed'}}}
            signature = hmac.new(self.config.external_probe_secret.encode(), canonical(payload), hashlib.sha256).hexdigest()
            self.assertTrue(accept(self.config, self.storage, payload, signature))
        evidence = service_evidence(self.config, self.storage, set(), startup_age=200)
        self.assertEqual(len(evidence), 2)
        self.assertTrue(all(item['status'] == 'running' for item in evidence))

    def test_panel_preflight_rejects_unrelated_tls_and_wrong_upstream(self):
        template = (Path(__file__).resolve().parents[2] / 'deploy/nginx.conf.example').read_text()
        self.assertTrue(panel_site(template, '127.0.0.1', 18080)['ok'])
        for invalid in (template.replace(' ssl http2', ''), template.replace('ssl_certificate ', 'unrelated_certificate '), template.replace(':18080;', ':18081;'), template.replace('location ^~ /api/', 'location /unrelated/'), template + template):
            self.assertFalse(panel_site(invalid, '127.0.0.1', 18080)['ok'])
        http_panel = 'server {listen 80;root /var/www/castorice-ui/current;location /api/ {proxy_pass http://127.0.0.1:18080;}}'
        self.assertFalse(panel_site(http_panel + 'server {listen 443 ssl;ssl_certificate /tmp/other;}', '127.0.0.1', 18080)['ok'])

    def test_archive_bounds_online_history_and_roundtrips_exact_evidence(self):
        with self.storage.connect() as connection:
            for index in range(1200):
                episode = f'qa-{index}'
                connection.execute('INSERT INTO alert_history VALUES(?,?,?,?,?,?)', (episode, episode, json.dumps({'id': episode}), '2025-01-01', '2025-01-02', '2025-01-02'))
                connection.execute('INSERT INTO alert_evidence VALUES(?,?,?,?,?)', (episode, '{"sample":1}', '{"sample":3}', '{"sample":2}', '2025-01-02'))
            connection.execute('INSERT INTO alert_history VALUES(?,?,?,?,?,?)', ('protected', 'protected', '{}', '2025-01-01', '2025-01-02', None))
        directory = self.root / 'archives'
        archived = 0
        while True:
            result = archive(self.storage, directory, days=180, limit=100)
            archived += result['archived']
            if not result['archived']: break
        self.assertEqual(archived, 1200)
        self.assertEqual(capacity(self.storage, 100)['episodes'], 1)
        self.assertEqual(self.storage.alert_history()[0]['episodeId'], 'protected')
        for path in directory.glob('*.gz'):
            restored = restore(self.storage, path)
            self.assertGreater(restored, 0)
            self.assertEqual(restore(self.storage, path), 0)
        self.assertEqual(capacity(self.storage, 100)['episodes'], 1201)
        self.assertEqual(self.storage.episode_evidence('qa-0')['worst'], {'sample': 2})
        path = next(directory.glob('*.gz'))
        path.write_bytes(path.read_bytes() + b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum'): restore(self.storage, path)

    def test_quota_worst_evidence_tracks_real_percentage(self):
        for percentage in (80, 94, 85):
            self.storage.reconcile_alerts([{'id': 'traffic-threshold', 'severity': 'warning', 'evidence': {'usedPercent': percentage}}])
        evidence = self.storage.episode_evidence(self.storage.active_alerts()[0]['episodeId'])
        self.assertEqual([evidence[key]['evidence']['usedPercent'] for key in ('first', 'worst', 'last')], [80, 94, 85])

    def test_optional_sqlite_sidecars_can_disappear_during_stat(self):
        original = Path.stat
        def disappearing(path, *args, **kwargs):
            if str(path).endswith(('-wal', '-shm')): raise FileNotFoundError()
            return original(path, *args, **kwargs)
        with patch.object(Path, 'stat', disappearing):
            self.assertGreater(self.storage.database_size(), 0)
        with patch.object(Path, 'stat', side_effect=PermissionError()):
            with self.assertRaises(PermissionError): self.storage.database_size()

    def test_optional_database_diagnostic_failure_keeps_host_snapshot(self):
        collector = self.dashboard.system_collector
        original_read = Path.read_text
        def reading(path, *args, **kwargs):
            return '3600 0' if path.as_posix() == '/proc/uptime' else original_read(path, *args, **kwargs)
        with patch.object(collector, 'cpu_percent', return_value=12.0), patch.object(collector, 'memory', return_value=(2_000_000_000, 800_000_000, 40.0)), patch.object(collector, 'network', return_value=(10000, 20000, 100, 200)), patch('castoriceui.collectors.os.getloadavg', return_value=(.1, .2, .3), create=True), patch.object(Path, 'read_text', reading), patch.object(self.storage, 'database_size', side_effect=FileNotFoundError()):
            result = self.dashboard.collect_system_snapshot()
        self.assertEqual(result['cpuPercent'], 12.0)
        self.assertEqual(result['downloadBps'], 100)
        self.assertIsNone(result['databaseBytes'])
        self.assertTrue(result['databaseWritable'])
        self.assertEqual(result['databaseDiagnosticError'], 'FileNotFoundError')

    def test_recovery_needs_two_good_rounds_and_exposes_observation(self):
        policy = NetworkPolicy()
        def sample(latency):
            return {'id': 'qa', 'address': '192.0.2.1', 'ipVersion': 4, 'status': 'healthy', 'measurementStatus': 'measured', 'complete': True, 'sent': 12, 'received': 12, 'loss': 0, 'latency': latency}
        for now in (100, 120, 140):
            bad = policy.apply([sample(200)], {'latencyMs': 150, 'lossPercent': 5}, now)[0]
        self.assertTrue(bad['alertConfirmed'])
        first = policy.apply([sample(1)], {'latencyMs': 150, 'lossPercent': 5}, 160)[0]
        self.assertTrue(first['alertConfirmed'])
        self.assertEqual(first['qualityWindow']['confirmation'], 'recovering')
        second = policy.apply([sample(1)], {'latencyMs': 150, 'lossPercent': 5}, 180)[0]
        self.assertFalse(second['alertConfirmed'])


class AuthenticationRegressions(IsolatedState):
    def setUp(self):
        super().setUp()
        self.user_id = self.storage.create_initial_user('qa-admin', 'Synthetic-Original-Password-123!')
        self.token, self.csrf, _ = self.storage.create_session(self.user_id, 3600)
        self.server = ApiServer(self.config, self.storage, self.dashboard)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(3)
        super().tearDown()

    def request(self, path, payload=None, *, token='', csrf='', method=None):
        headers = {'Content-Type': 'application/json', 'X-CastoriceUI-Request': '1'}
        if token: headers['Cookie'] = 'castorice_session=' + token
        if csrf: headers['X-CSRF-Token'] = csrf
        client = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        try:
            client.request(method or ('POST' if payload is not None else 'GET'), path, json.dumps(payload) if payload is not None else None, headers)
            response = client.getresponse()
            return response.status, json.loads(response.read()), response.getheader('Set-Cookie')
        finally: client.close()

    def test_password_change_revokes_an_already_verified_login(self):
        verified, resume, changed = threading.Event(), threading.Event(), threading.Event()
        original = self.storage.create_session
        results = {}
        def delayed(*args):
            verified.set()
            if not resume.wait(6): raise RuntimeError('Test barrier timed out')
            return original(*args)
        def login(): results['login'] = self.request('/api/v2/auth/login', {'username': 'qa-admin', 'password': 'Synthetic-Original-Password-123!'})
        def change():
            results['change'] = self.request('/api/v2/auth/change-password', {'currentPassword': 'Synthetic-Original-Password-123!', 'newPassword': 'Synthetic-New-Password-456!'}, token=self.token, csrf=self.csrf)
            changed.set()
        with patch.object(self.storage, 'create_session', side_effect=delayed):
            first = threading.Thread(target=login); first.start()
            self.assertTrue(verified.wait(4))
            second = threading.Thread(target=change); second.start()
            self.assertFalse(changed.wait(.1))
            resume.set(); first.join(8); second.join(8)
        self.assertEqual(results['change'][0], 200)
        stale_token = results['login'][2].split(';')[0].split('=', 1)[1]
        self.assertEqual(self.request('/api/v2/auth/session', token=stale_token)[0], 401)
        self.assertEqual(self.request('/api/v2/auth/login', {'username': 'qa-admin', 'password': 'Synthetic-New-Password-456!'})[0], 200)

    def test_distributed_failures_have_bounded_cost_without_persistent_global_lock(self):
        for index in range(30): self.storage.record_login_failure(f'198.51.100.{index + 1}')
        self.assertEqual(self.request('/api/v2/auth/login', {'username': 'qa-admin', 'password': 'Synthetic-Original-Password-123!'})[0], 200)
        self.server.authentication_slots.acquire(); self.server.authentication_slots.acquire()
        try:
            self.assertEqual(self.request('/api/v2/auth/login', {'username': 'qa-admin', 'password': 'Synthetic-Original-Password-123!'})[0], 429)
            self.assertEqual(self.request('/api/v2/health')[0], 200)
            with self.assertRaises(AuthenticationBusy):
                with self.server.authentication_gate(): pass
        finally:
            self.server.authentication_slots.release(); self.server.authentication_slots.release()

    def test_non_ascii_csrf_and_bootstrap_are_controlled_rejections(self):
        self.assertEqual(self.request('/api/v2/auth/logout', {}, token=self.token, csrf='é')[0], 403)
        self.assertEqual(self.request('/api/v2/health')[0], 200)
        Path(self.config.bootstrap_token_path).write_text('synthetic-bootstrap-1234567890')
        self.assertTrue(self.server.verify_bootstrap('synthetic-bootstrap-1234567890'))
        self.assertFalse(self.server.verify_bootstrap('中文'))
        self.assertFalse(self.server.verify_bootstrap('\ud800'))

    def test_setup_reports_unchecked_subscriptions_without_a_publisher_failure_verdict(self):
        self.config.subscriptions = [{'url': f'https://publisher.example.com/{index}'} for index in range(51)]
        with patch('castoriceui.dashboard.probe_subscription_url', return_value={'format': 'uri', 'nodeCount': 1}):
            status, body, _ = self.request('/api/v2/integrations/subscriptions', {'enabled': True, 'values': {}}, token=self.token, csrf=self.csrf, method='PUT')
        self.assertEqual(status, 503)
        self.assertEqual(body['error'], 'subscription_check_incomplete')
