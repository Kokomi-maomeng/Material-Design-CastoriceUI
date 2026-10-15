"""Real isolated API/SQLite workflows; no production data or API route mocks."""
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import ssl
from unittest.mock import patch
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from castoriceui.api import ApiServer
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.storage import Storage


def main():
    engines = sys.argv[1:] or ['chromium', 'firefox', 'webkit']
    with tempfile.TemporaryDirectory(prefix='castorice-v51-browser-') as temporary:
        folder = Path(temporary)
        config_file = folder / 'config.json'
        url = 'https://publisher.example.com/sub/synthetic-browser-only'
        config_file.write_text(json.dumps({'database_path': str(folder / 'state.db'), 'bootstrap_token_path': str(folder / 'bootstrap'), 'login_background_directory': str(folder / 'images'), 'subscriptions': [{'id': 'qa-sub', 'account': 'Synthetic QA', 'url': url, 'protocols': ['AnyTLS'], 'enabled': True}]}))
        config = AppConfig.load(config_file)
        config.listen_port = 0
        storage = Storage(config.database_path)
        storage.create_initial_user('qa-browser', 'Synthetic-Password-123!')
        storage.set_setting('initial_setup_complete', True)
        dashboard = DashboardService(config, storage)
        with contextlib.ExitStack() as stack:
            if sys.platform == 'win32':
                # Substitute only Linux OS readings. HTTP, auth, SQLite, routing,
                # subscription disclosure and UI components are the real paths.
                original_read = Path.read_text
                def read(path, *args, **kwargs):
                    return '3600 0' if path.as_posix() == '/proc/uptime' else original_read(path, *args, **kwargs)
                stack.enter_context(patch.object(dashboard.system_collector, 'cpu_percent', return_value=12.0))
                stack.enter_context(patch.object(dashboard.system_collector, 'memory', return_value=(2_000_000_000, 800_000_000, 40.0)))
                stack.enter_context(patch.object(dashboard.system_collector, 'network', return_value=(10000, 20000, 100, 200)))
                stack.enter_context(patch('castoriceui.collectors.os.getloadavg', return_value=(.1, .2, .3), create=True))
                stack.enter_context(patch.object(Path, 'read_text', read))
            dashboard.collect_system_snapshot()
            dashboard.refresh_services()
            backend = ApiServer(config, storage, dashboard)
            backend_errors = []
            backend.handle_error = lambda *_args: backend_errors.append('uncaught-http-error')
            thread = threading.Thread(target=backend.serve_forever, daemon=True); thread.start()
            with socket.socket() as available:
                available.bind(('127.0.0.1', 0)); port = available.getsockname()[1]
            env = {**os.environ, 'CASTORICEUI_DEV_API_TARGET': f'http://127.0.0.1:{backend.server_port}'}
            with (folder / 'vite.log').open('w') as output:
                dev = subprocess.Popen([shutil.which('node'), str(ROOT / 'node_modules/vite/bin/vite.js'), '--port', str(port), '--strictPort'], cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                try:
                    origin = f'https://127.0.0.1:{port}'
                    for _ in range(100):
                        try:
                            urllib.request.urlopen(origin, context=ssl._create_unverified_context(), timeout=1).close(); break
                        except OSError:
                            if dev.poll() is not None: raise RuntimeError('Isolated development server exited')
                            time.sleep(.1)
                    else: raise TimeoutError('Isolated development server did not start')
                    results = []
                    with sync_playwright() as playwright:
                        for engine in engines:
                            browser = getattr(playwright, engine).launch()
                            try:
                                for motion in ('reduce', 'no-preference'):
                                    for clipboard in ('denied', 'missing', 'insecure-context'):
                                        context = browser.new_context(ignore_https_errors=True, reduced_motion=motion, viewport={'width': 390, 'height': 844})
                                        script = "localStorage.setItem('castorice-language','en');document.execCommand=()=>false;"
                                        script += "Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});" if clipboard == 'missing' else "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Synthetic denial')}}});"
                                        if clipboard == 'insecure-context': script += "Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});"
                                        context.add_init_script(script)
                                        page = context.new_page()
                                        errors = []
                                        page.on('pageerror', lambda error: errors.append(str(error)))
                                        page.goto(origin, wait_until='networkidle')
                                        page.get_by_label('Username', exact=True).fill('qa-browser')
                                        page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
                                        page.get_by_role('button', name='Sign in', exact=True).click()
                                        page.locator('#main-content').wait_for()
                                        page.goto(origin + '/#/subscriptions', wait_until='networkidle')
                                        page.get_by_role('button', name='Copy URL', exact=True).click()
                                        address = page.get_by_role('textbox', name='Subscription URL', exact=True)
                                        address.wait_for(state='visible')
                                        assert address.input_value() == url
                                        address.focus(); address.press('Control+A')
                                        assert address.evaluate('element=>element.selectionStart===0 && element.selectionEnd===element.value.length')
                                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
                                        page.get_by_role('button', name='Done', exact=True).click()
                                        assert page.get_by_role('textbox', name='Subscription URL', exact=True).count() == 0
                                        assert not errors and not backend_errors, (errors, backend_errors)
                                        results.append({'engine': engine, 'motion': motion, 'clipboard': clipboard, 'realApi': True, 'selectableAddress': True, 'secretClearedOnClose': True})
                                        context.close()
                            finally: browser.close()
                    print(json.dumps({'cases': results, 'apiRoutesMocked': False, 'windowsOsReadingsSubstituted': sys.platform == 'win32', 'backendErrors': backend_errors}))
                finally:
                    dev.terminate()
                    try: dev.wait(10)
                    except subprocess.TimeoutExpired: dev.kill(); dev.wait()
                    backend.shutdown(); backend.server_close(); thread.join(3)


if __name__ == '__main__':
    main()
