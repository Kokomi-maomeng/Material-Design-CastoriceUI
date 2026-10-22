"""Audit fixes against isolated real HTTP/SQLite and the actual browser client."""
import contextlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from unittest.mock import patch
from playwright.sync_api import sync_playwright
from qa_browser import settled, open_page

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from castoriceui.api import ApiServer
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.storage import Storage


def main():
    reports = []
    with tempfile.TemporaryDirectory(prefix='castorice-v56-') as temporary, contextlib.ExitStack() as stack:
        folder = Path(temporary)
        config_path = folder / 'config.json'
        config_path.write_text(json.dumps({'database_path': str(folder / 'state.db'), 'bootstrap_token_path': str(folder / 'bootstrap')}))
        config = AppConfig.load(config_path); config.listen_port = 0
        storage = Storage(config.database_path)
        storage.create_initial_user('qa-browser', 'Synthetic-Password-123!')
        storage.set_setting('initial_setup_complete', True)
        dashboard = DashboardService(config, storage)
        if sys.platform == 'win32':
            original_read = Path.read_text
            def read(path, *args, **kwargs):
                return '3600 0' if path.as_posix() == '/proc/uptime' else original_read(path, *args, **kwargs)
            stack.enter_context(patch.object(dashboard.system_collector, 'cpu_percent', return_value=12.0))
            stack.enter_context(patch.object(dashboard.system_collector, 'memory', return_value=(2_000_000_000, 800_000_000, 40.0)))
            stack.enter_context(patch.object(dashboard.system_collector, 'network', return_value=(10000, 20000, 100, 200)))
            stack.enter_context(patch('castoriceui.collectors.os.getloadavg', return_value=(.1, .2, .3), create=True))
            stack.enter_context(patch.object(Path, 'read_text', read))
        host = dashboard.collect_system_snapshot()
        def refresh(percent=50, attention=False, size=4096):
            now = datetime.now(timezone.utc).isoformat()
            dashboard.system_cache = {**host, 'diskPercent': percent, 'databaseBytes': size, 'alertCapacity': {'requiresAttention': attention}}
            dashboard.runtime_cache['observedAt'] = now
            for name in ('system', 'runtime', 'network', 'subscriptions'):
                dashboard._collection_result(name, observed_at=now)
            dashboard.runtime_cache['alerts'] = dashboard.alerts(dashboard.system_cache, [], [], [])
        refresh()
        backend = ApiServer(config, storage, dashboard)
        errors = []; backend.handle_error = lambda *_args: errors.append('uncaught-http-error')
        thread = threading.Thread(target=backend.serve_forever, daemon=True); thread.start()
        stack.callback(backend.server_close); stack.callback(backend.shutdown)
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0)); port = available.getsockname()[1]
        env = {**os.environ, 'CASTORICEUI_DEV_API_TARGET': f'http://127.0.0.1:{backend.server_port}'}
        output = stack.enter_context((folder / 'vite.log').open('w'))
        dev = subprocess.Popen([shutil.which('node'), str(ROOT / 'node_modules/vite/bin/vite.js'), '--port', str(port), '--strictPort'], cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        stack.callback(dev.wait, timeout=10); stack.callback(dev.terminate)
        origin = f'https://127.0.0.1:{port}'
        for _ in range(100):
            try:
                urllib.request.urlopen(origin, context=ssl._create_unverified_context(), timeout=1).close(); break
            except OSError:
                if dev.poll() is not None: raise RuntimeError('Isolated Vite exited')
                time.sleep(.1)
        else: raise TimeoutError('Isolated Vite did not start')
        with sync_playwright() as playwright:
            for engine in sys.argv[1:] or ['chromium', 'firefox', 'webkit']:
                browser = getattr(playwright, engine).launch()
                context = browser.new_context(ignore_https_errors=True, viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
                context.add_init_script("localStorage.setItem('castorice-language','en')")
                page = context.new_page(); page_errors = []
                page.on('pageerror', lambda e: page_errors.append(str(e)))
                page.goto(origin, wait_until='networkidle')
                page.get_by_label('Username', exact=True).fill('qa-browser')
                page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
                page.get_by_role('button', name='Sign in', exact=True).click()
                page.locator('#main-content').wait_for(); settled(page)
                csrf = context.request.get(origin + '/api/v2/auth/session').json()['csrfToken']
                headers = {'X-CSRF-Token': csrf, 'X-CastoriceUI-Request': '1'}
                capacity_cases = []
                for percent, attention, expected in ((89.9, False, False), (90, False, True), (91, False, True), (50, True, True)):
                    refresh(percent, attention)
                    page.reload(wait_until='networkidle'); page.locator('#main-content').wait_for(); settled(page)
                    body = context.request.get(origin + '/api/v2/dashboard').json()
                    assert page.locator('.boot-state').count() == 0
                    capacity = [a for a in body['alerts'] if a['id'] == 'storage-capacity']
                    assert bool(capacity) == expected and all(a['time'] == a['startedAt'] for a in capacity)
                    capacity_cases.append({'diskPercent': percent, 'attention': attention, 'visible': expected})
                open_page(page, 'alerts', 'Alerts')
                page.get_by_role('button', name='All records', exact=True).click()
                page.get_by_text('Storage capacity requires attention', exact=True).first.wait_for()
                episode = next(a for a in body['alerts'] if a['id'] == 'storage-capacity')['episodeId']
                assert context.request.post(origin + '/api/v2/alerts/' + episode + '/ack', data={}, headers=headers).ok
                refresh(size=None)
                page.reload(wait_until='networkidle'); page.locator('#main-content').wait_for(); settled(page)
                open_page(page, 'services', 'Services')
                page.get_by_text('Sample write succeeded · size unavailable', exact=True).wait_for()
                refresh(size=4096)
                page.reload(wait_until='networkidle'); page.locator('#main-content').wait_for(); settled(page)
                assert page.get_by_text('Sample write succeeded · size unavailable', exact=True).count() == 0
                connection_cases = []
                for hy, sb, hy_ok, sb_ok, expected in ((1, 0, 1, 0, 'ready'), (0, 1, 0, 1, 'ready'), (1, 1, 1, 1, 'ready'), (1, 1, 1, 0, 'partial'), (0, 0, 0, 0, 'pending')):
                    config.hysteria_api = {'url': 'http://127.0.0.1:19090' if hy else ''}
                    config.singbox_api = {'url': 'http://127.0.0.1:19091' if sb else ''}
                    hy2 = {'available': bool(hy_ok), 'endpointStatus': {'streams': bool(hy_ok)}, 'traffic': {}, 'online': {}, 'streams': []}
                    sb_data = {'available': bool(sb_ok), 'connections': [], 'traffic': {}, 'inventory': {}}
                    dashboard.runtime_cache.update(hy2=hy2, singbox=sb_data)
                    now = datetime.now(timezone.utc).isoformat()
                    for name, ok in (('hysteria2', hy_ok), ('singbox', sb_ok)):
                        dashboard._collection_result(name, observed_at=now, error=None if ok else 'adapter_unavailable')
                    dashboard.runtime_cache['integrations'] = dashboard.runtime_integrations(hy2, sb_data, [], dashboard.system_cache, {'configured': False, 'ready': False, 'count': 0})
                    refresh()
                    page.reload(wait_until='networkidle'); page.locator('#main-content').wait_for(); settled(page)
                    open_page(page, 'connections', 'Active connections')
                    response = context.request.get(origin + '/api/v2/dashboard').json()
                    state = next(i for i in response['integrations'] if i['id'] == 'connections')
                    assert state['status'] == expected
                    if expected == 'partial': page.get_by_text('Connection snapshots partially available', exact=True).wait_for()
                    if expected == 'ready': assert page.locator('.integration-gate').count() == 0
                    connection_cases.append(expected)
                target = {'name': 'Synthetic DNS', 'address': '2606:4700:4700::1111', 'ipVersion': 6, 'order': 1, 'latencyMs': 321, 'lossPercent': 7, 'tcpPort': 443, 'dnsPort': 53, 'dnsName': 'example.com'}
                assert context.request.put(origin + '/api/v2/settings/network-targets', data={'targets': [target]}, headers=headers).ok
                refresh()
                page.reload(wait_until='networkidle'); page.locator('#main-content').wait_for(); settled(page)
                open_page(page, 'network', 'Network quality')
                page.get_by_role('button', name='Customize', exact=True).click()
                editor = page.get_by_role('dialog'); editor.wait_for()
                editor.locator('input').first.fill('Renamed immediately')
                editor.get_by_role('button', name='Save', exact=True).click()
                editor.wait_for(state='hidden')
                saved = storage.get_setting('network_targets', [])[0]
                assert all(saved[key] == target[key] for key in ('latencyMs', 'lossPercent', 'tcpPort', 'dnsPort', 'dnsName', 'address'))
                assert saved['name'] == 'Renamed immediately'
                original = {'type': 'url', 'value': 'https://images.example.com/image', 'fit': 'cover', 'cacheSeconds': 0, 'glass': 'default', 'glassEnabled': False}
                storage.set_setting('login_background', original)
                for invalid in ('', 'letters', '0', '65536', '-1'):
                    result = context.request.put(origin + '/api/v2/settings/login-background', data={**original, 'value': 'https://images.example.com:' + invalid + '/image'}, headers=headers)
                    assert result.status == 400 and result.json()['field'] == 'value'
                    assert storage.get_setting('login_background', {}) == original
                assert not page_errors and not errors
                reports.append({'engine': engine, 'capacityCases': capacity_cases, 'nullCapacityRecovery': True, 'connectionCases': connection_cases, 'pendingThresholdPersistence': True, 'invalidPortsRejected': 5, 'pageErrors': page_errors})
                context.close(); browser.close()
    print(json.dumps({'auditFixes': reports, 'apiRoutesMocked': False, 'backendErrors': errors, 'passed': True}), flush=True)


if __name__ == '__main__': main()
