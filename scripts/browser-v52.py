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
    with tempfile.TemporaryDirectory(prefix='castorice-v52-browser-') as temporary:
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
                    from datetime import datetime, timezone
                    # Fixed synthetic SQL rows exercise the real API query and pagination.
                    with storage.connect() as connection:
                        for index in range(145):
                            started = "2026-10-15T12:00:00Z" if index % 2 else "2026-10-16T02:00:00Z"
                            resolved = "2026-10-16T02:30:00Z" if index % 2 else None
                            payload = {"id": "qa-event-" + str(index), "title": "Synthetic event " + str(index), "description": "Synthetic condition", "severity": ("critical", "warning", "info")[index % 3], "source": "Monitor evidence", "time": "now"}
                            connection.execute("INSERT INTO alert_history VALUES(?,?,?,?,?,NULL)", ("qa-episode-"+str(index),payload["id"],json.dumps(payload),started,resolved))
                    for _ in range(140): storage.add_audit("登录成功", "认证", "Synthetic audit", actor="QA", source_ip="192.0.2.1")
                    with sync_playwright() as playwright:
                        for engine in engines:
                            browser = getattr(playwright, engine).launch()
                            try:
                                for motion in ("reduce", "no-preference"):
                                    for language in ("en", "zh"):
                                        context = browser.new_context(ignore_https_errors=True, reduced_motion=motion, timezone_id="Asia/Shanghai", viewport={"width":1440,"height":1000})
                                        context.add_init_script("localStorage.setItem('castorice-language',"+json.dumps(language)+")")
                                        context.add_init_script("window.qaRecordAnimations=[];const originalAnimate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.closest('.record-transition'))window.qaRecordAnimations.push({height:frames.some(frame=>'height' in frame),opacity:frames.some(frame=>'opacity' in frame)});return originalAnimate.call(this,frames,options)}")
                                        login = context.request.post(origin + '/api/v2/auth/login', data={"username":"qa-browser","password":"Synthetic-Password-123!"})
                                        assert login.status == 200
                                        csrf = login.json()["csrfToken"]
                                        page = context.new_page(); errors=[]; requests=[]; responses=[]
                                        page.on('pageerror', lambda error: errors.append(type(error).__name__))
                                        page.on('request', lambda request: requests.append(request.url) if '/api/v2/alerts?' in request.url or '/api/v2/audits?' in request.url else None)
                                        page.on('response', lambda response: responses.append(response.url) if '/api/v2/alerts?' in response.url or '/api/v2/audits?' in response.url else None)
                                        t=lambda en,zh: zh if language=='zh' else en
                                        for width,height in ((1440,1000),(390,844),(320,700)):
                                            print(json.dumps({"caseStart": {"engine":engine,"language":language,"motion":motion,"width":width}}), flush=True)
                                            page.set_viewport_size({"width":width,"height":height})
                                            for section, selector, expand in (("alerts",".alert-row",t("Show all records","展开全部记录")),("audit",".audit-table tbody tr",t("Show all logs","展开全部日志"))):
                                                page.goto(origin+'/#/'+section,wait_until='networkidle')
                                                page.locator(selector).nth(29).wait_for()
                                                assert page.locator(selector).count()==30
                                                controls=page.locator('.audit-controls');controls.scroll_into_view_if_needed()
                                                y=page.evaluate('scrollY');calls=len(requests)
                                                page.get_by_role('button',name=expand,exact=True).click()
                                                assert page.locator(selector).count()==50
                                                animation_count=page.evaluate('window.qaRecordAnimations.filter(item=>item.height).length')
                                                assert (animation_count>0) == (motion=='no-preference'), ('height animation preference',engine,motion,animation_count)
                                                assert all('pageSize=50' in url for url in requests[calls:]), 'toggle requested a different snapshot size'
                                                page.wait_for_timeout(260)
                                                assert abs(page.evaluate('scrollY')-y)<3, ('expand moved scroll',engine,width,y,page.evaluate('scrollY'))
                                                page.get_by_role('button',name=t('Collapse to latest 30','收起到最近 30 条'),exact=True).click()
                                                assert page.locator(selector).count()==30
                                                assert all('pageSize=50' in url for url in requests[calls:]), 'toggle requested a different snapshot size'
                                                page.wait_for_timeout(260)
                                                assert page.evaluate('scrollY')>0, 'collapse jumped to page top'
                                                page.get_by_role('button',name=expand,exact=True).click()
                                                page.locator('.md-pagination').get_by_role('button',name='2',exact=True).click()
                                                page.wait_for_function("document.querySelector('.audit-controls strong').textContent.includes('2')")
                                                assert page.locator(selector).count()==50
                                                page.get_by_role('button',name=t('Collapse to latest 30','收起到最近 30 条'),exact=True).click()
                                                assert page.locator(selector).count()==30
                                                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+2')
                                            page.goto(origin+'/#/alerts',wait_until='networkidle')
                                            assert page.get_by_role('button',name='View evidence',exact=True).count()==0
                                            assert page.get_by_text('Monitor evidence',exact=True).count()==0
                                            for stamp in page.locator('.alert-row time').all_text_contents(): assert '1970' not in stamp and '2026' in stamp
                                            page.get_by_role('button',name=t('Filter','筛选'),exact=True).click()
                                            filter=page.get_by_role('dialog',name=t('Filter alerts','筛选告警'),exact=True)
                                            if os.environ.get('CASTORICEUI_QA_SCREENSHOTS') and language=='zh' and motion=='no-preference':
                                                filter.wait_for(state='visible')
                                                page.wait_for_function("()=>{const el=document.querySelector('.alert-filter.is-open');return el && getComputedStyle(el).visibility==='visible' && Number(getComputedStyle(el).opacity)>.99}")
                                                shots=Path(os.environ['CASTORICEUI_QA_SCREENSHOTS']);shots.mkdir(parents=True,exist_ok=True)
                                                page.screenshot(path=str(shots/('filter-'+engine+'-'+str(width)+'.png')))
                                            for bound,label in (("From date","开始日期"),("To date","结束日期")):
                                                filter.get_by_role('button',name=t(bound,label),exact=True).click()
                                                calendar=page.get_by_role('dialog',name=t(bound,label),exact=True)
                                                calendar.get_by_role('button',name=t('Today','今天'),exact=True).click()
                                                assert filter.is_visible(), 'calendar dismissed the filter'
                                            filter.get_by_role('button',name=t('Active','正在发生'),exact=True).click()
                                            filter.get_by_role('button',name=t('Info','提醒'),exact=True).click()
                                            filter.get_by_role('button',name=t('Apply filters','应用筛选'),exact=True).click()
                                            page.wait_for_timeout(200)
                                            data=context.request.get(origin+'/api/v2/alerts?filter=pending&status=active&severity=info&pageSize=50').json()
                                            page.locator('.alert-summary').get_by_role('button',name=t('Warning','警告'),exact=False).click()
                                            page.get_by_role('button',name=t('Filter · 3','筛选 · 3'),exact=True).click()
                                            filter=page.get_by_role('dialog',name=t('Filter alerts','筛选告警'),exact=True)
                                            assert filter.get_by_role('button',name=t('Warning','警告'),exact=True).get_attribute('aria-pressed')=='true'
                                            filter.get_by_role('button',name=t('Reset','重置'),exact=True).click()
                                            filter.get_by_role('button',name=t('Apply filters','应用筛选'),exact=True).click()
                                            page.locator('.alert-row').nth(29).wait_for()
                                            page.locator('.alert-row').first.get_by_text(t('Log location','日志位置'),exact=True).click()
                                            assert storage.path in page.locator('.alert-log-location[open]').inner_text()
                                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+2')
                                            results.append({"engine":engine,"language":language,"motion":motion,"width":width,"immediateToggle":True,"scrollPreserved":True,"combinedFilters":True,"calendarPortal":True,"logLocator":True})
                                        assert not errors and not backend_errors,(errors,backend_errors)
                                        logout=context.request.post(origin+'/api/v2/auth/logout',headers={"X-CastoriceUI-Request":"1","X-CSRF-Token":csrf});assert logout.status==200
                                        context.close()
                            finally: browser.close()
                    print(json.dumps({"cases":results,"apiRoutesMocked":False,"windowsOsReadingsSubstituted":sys.platform=='win32',"backendErrors":backend_errors}))
                finally:
                    dev.terminate()
                    try: dev.wait(10)
                    except subprocess.TimeoutExpired: dev.kill(); dev.wait()
                    backend.shutdown(); backend.server_close(); thread.join(3)


if __name__ == '__main__':
    main()
