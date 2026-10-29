"""Populated product acceptance with real HTTP/session/SQLite and synthetic core samples."""
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

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from castoriceui.api import ApiServer
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.storage import Storage

WIDTHS=(320,360,375,390,412,430,680,681,760,761,768,820,844,900,901,1024,1280,1440,1920)
PROTOCOLS=('Hysteria2','AnyTLS','VLESS','VLESS · XTLS Vision','VLESS · Reality','VLESS · XTLS Vision · Reality','SOCKS5','Shadowsocks','VMess','Trojan','TUIC')


def main():
    with tempfile.TemporaryDirectory(prefix='castorice-v57-') as temporary,contextlib.ExitStack() as stack:
        folder=Path(temporary)
        config=AppConfig(database_path=str(folder/'state.db'),listen_port=0)
        config.node_name='Synthetic QA'
        config.hysteria_api={'url':'http://127.0.0.1:19090'}
        config.singbox_api={'url':'http://127.0.0.1:19091'}
        storage=Storage(config.database_path)
        storage.create_initial_user('qa-browser','Synthetic-Password-123!')
        storage.set_setting('initial_setup_complete',True)
        dashboard=DashboardService(config,storage)
        stamp=datetime.now(timezone.utc).isoformat()
        dashboard.system_cache={'observedAt':stamp,'nodeName':'Synthetic QA','kernel':'QA Linux','cpuCores':2,'load':[.1,.2,.3],'uptimeSeconds':3600,'cpuPercent':12,'memoryPercent':40,'memoryTotalBytes':2_000_000_000,'memoryUsedBytes':800_000_000,'diskPercent':20,'diskTotalBytes':20_000_000_000,'diskUsedBytes':4_000_000_000,'databaseBytes':4096,'databaseWritable':True,'interface':'qa0','uploadBps':6789,'downloadBps':12345,'trafficUsedBytes':0,'trafficLimitBytes':10**12}
        dashboard.system_cache.update(trafficCycleStart=stamp,trafficBaselineBytes=0,trafficCountMode='sum',trafficQuotaUnit='GB')
        dashboard.runtime_cache.update(hy2={'available':True,'endpointStatus':{'streams':True,'online':True},'online':{'QA':4},'traffic':{}},singbox={'available':True,'traffic':{},'connections':[]},services=[],integrations=[])
        def refresh(count=100,protocols=PROTOCOLS):
            stamp=datetime.now(timezone.utc).isoformat()
            raw=[]
            for index,protocol in enumerate(protocols):
                for i in range(count if index==0 else 1):
                    raw.append({'id':f'{index}-{i}','protocol':protocol,'account':'QA' if protocol=='Hysteria2' else '', 'sourceIp':'' if protocol=='Hysteria2' else '2001:db8:abcd:4f00:58f2:d72c:68ff:83b2' if index==1 else f'192.0.2.{index+1}', 'ipVersion':None if protocol=='Hysteria2' else 6 if index==1 else 4, 'uploadedBytes':i*100,'downloadedBytes':i*200,'connectedAt':stamp,'destination':f'target-{index}-{i}.'+'long-domain-'*5+'example.test:443' if i%2 else f'[2001:db8::{i+1}]:443'})
            dashboard.connection_baseline={}
            with patch('castoriceui.dashboard.time.monotonic',return_value=10):dashboard.aggregate_connections(raw)
            with patch('castoriceui.dashboard.time.monotonic',return_value=15):
                groups=dashboard.aggregate_connections([{**r,'downloadedBytes':r['downloadedBytes']+int(r['id'].split('-')[1])*100} for r in raw])
            with dashboard.lock:
                dashboard.runtime_cache['connections']=dashboard.with_online_clients(groups,dashboard.runtime_cache['hy2']) if count else []
                dashboard.runtime_cache['observedAt']=stamp;dashboard.system_cache['observedAt']=stamp
                for name in ('system','runtime','hysteria2','singbox','network','subscriptions'):dashboard._collection_result(name,observed_at=stamp)
        refresh()
        server=ApiServer(config,storage,dashboard)
        server_errors=[];server.handle_error=lambda *_:server_errors.append('HTTP failure')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        stack.callback(server.server_close);stack.callback(server.shutdown)
        with socket.socket() as available:available.bind(('127.0.0.1',0));port=available.getsockname()[1]
        output=stack.enter_context((folder/'vite.log').open('w'))
        dev=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--port',str(port),'--strictPort'],cwd=ROOT,env={**os.environ,'CASTORICEUI_DEV_API_TARGET':f'http://127.0.0.1:{server.server_port}'},stdout=output,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        stack.callback(dev.wait,timeout=10);stack.callback(dev.terminate)
        origin=f'https://127.0.0.1:{port}'
        for _ in range(100):
            try:urllib.request.urlopen(origin,context=ssl._create_unverified_context(),timeout=1).close();break
            except OSError:
                if dev.poll() is not None:raise RuntimeError('Isolated development server exited')
                time.sleep(.1)
        else:raise TimeoutError('Development server unavailable')
        with sync_playwright() as playwright:
            for engine in sys.argv[1:] or ('chromium','firefox','webkit'):
                browser=getattr(playwright,engine).launch()
                context=browser.new_context(ignore_https_errors=True,viewport={'width':390,'height':844},device_scale_factor=3,has_touch=True)
                context.add_init_script("if(!localStorage.getItem('castorice-language'))localStorage.setItem('castorice-language','en')")
                page=context.new_page();errors=[];requests=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('request',lambda request:requests.append(request.url) if '/connections/targets' in request.url else None)
                page.goto(origin,wait_until='networkidle')
                page.get_by_label('Username',exact=True).fill('qa-browser');page.get_by_label('Password',exact=True).fill('Synthetic-Password-123!')
                page.get_by_role('button',name='Sign in',exact=True).click();page.locator('#main-content').wait_for()
                open_page(page,'connections','Active connections')
                assert not requests and page.locator('.connection-disclosure').count()==0
                def geometry():
                    # Inline boxes have clientWidth=0 in Firefox despite painted
                    # text fitting their parent. Measure every real client box,
                    # including inline-flex chips/rates, and retain diagnostics.
                    return page.evaluate('''()=>{const cards=[...document.querySelectorAll('.connection-card')];const over=[...document.querySelectorAll('.connections-page *')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width&&r.height&&e.clientWidth>0&&s.display!=='none'&&e.scrollWidth>e.clientWidth+2&&!e.closest('details:not([open])')}).map(e=>({tag:e.tagName,className:String(e.className),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,display:getComputedStyle(e).display,text:e.textContent.slice(0,80)}));return {width:innerWidth,doc:document.documentElement.scrollWidth,over,gap:cards.length>1?cards[1].getBoundingClientRect().top-cards[0].getBoundingClientRect().bottom:0}}''')
                # Hidden 0/1/50/100 streams must not create spacing or focus targets.
                for count in (0,1,50,100):
                    refresh(count);page.reload(wait_until='networkidle');open_page(page,'connections','Active connections')
                    assert page.locator('.connection-disclosure').count()==0
                    value=geometry();assert value['doc']<=value['width']+1 and not value['over'],value
                    if count:assert abs(value['gap']-12)<1,value
                switch = page.locator('.connection-summary').get_by_role('switch',name='Show live connections',exact=True)
                assert switch.get_attribute('aria-checked') == 'false'
                assert page.get_by_text('About these measurements',exact=True).count() == 0
                switch.click()
                page.locator('.connection-disclosure').first.wait_for();disclosure=page.locator('.connection-disclosure').first
                assert switch.get_attribute('aria-checked') == 'true'
                assert all('[' not in value and ']' not in value for value in page.locator('.connection-target code').all_text_contents())
                assert page.locator('.connection-port').first.inner_text() == 'Port 443'
                assert page.locator('.connection-target-list').first.locator('li').count()==10
                assert disclosure.get_attribute('open') is not None
                disclosure.locator('summary').press('Enter');settled(page)
                assert disclosure.get_attribute('open') is None
                disclosure.locator('summary').press('Enter');settled(page)
                assert disclosure.get_attribute('open') is not None
                disclosure.get_by_role('searchbox').fill('target-0-99.')
                assert disclosure.locator('.connection-target').count()==1
                refresh(3)
                page.get_by_text('No matching destinations',exact=True).wait_for()
                assert disclosure.get_by_role('searchbox').input_value()=='target-0-99.'
                disclosure.get_by_role('searchbox').fill('')
                assert disclosure.locator('.connection-target').count()==3
                refresh(100)
                page.get_by_text('100 TCP connections',exact=True).wait_for()
                disclosure.get_by_role('searchbox').wait_for(state='visible')
                disclosure.get_by_role('searchbox').fill('')
                disclosure.get_by_role('button',name='Show 10 more',exact=True).click()
                assert disclosure.locator('.connection-target').count()==20
                copied=disclosure.locator('.connection-target code').first.inner_text()
                # Observe the actual clipboard write without opening OS permission prompts.
                page.evaluate("()=>{window.qaCopied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.qaCopied=value}}})}")
                disclosure.locator('.copy-ip-button').first.click()
                assert page.evaluate('window.qaCopied')==copied
                first_id=page.locator('.connection-card').first.get_attribute('data-connection-id')
                with dashboard.lock:dashboard.runtime_cache['connections'].reverse()
                page.wait_for_function('(id)=>document.querySelector(".connection-card").dataset.connectionId!==id',arg=first_id,timeout=8000)
                assert page.locator(f'[data-connection-id="{first_id}"] details').get_attribute('open') is not None
                with dashboard.lock:dashboard.runtime_cache['connections'].reverse()
                page.get_by_role('switch',name='Show live connections',exact=True).click()
                assert page.locator('.connection-disclosure').count()==0 and page.locator('.connection-target').count()==0
                page.get_by_role('button',name='Filter',exact=True).click();page.get_by_role('button',name='Source IP',exact=True).click()
                page.get_by_role('option',name='IPv4',exact=True).click();settled(page)
                page.get_by_role('button',name='Protocol',exact=True).click();page.get_by_role('option',name='Hysteria2',exact=True).click();settled(page)
                page.get_by_text('No connections match these filters',exact=True).wait_for()
                page.get_by_role('button',name='Clear filters',exact=True).first.click()
                page.get_by_role('button',name='Filter',exact=True).click()
                layouts=0
                for language in ('en','zh'):
                    for theme in ('light','dark'):
                        refresh()
                        page.evaluate('v=>{localStorage.setItem("castorice-language",v[0]);localStorage.setItem("castorice-theme-mode",v[1])}',[language,theme])
                        page.reload(wait_until='networkidle');open_page(page,'connections','Active connections' if language=='en' else '在线连接')
                        for motion in ('reduce','no-preference'):
                            page.emulate_media(reduced_motion=motion)
                            for width in WIDTHS:
                                page.set_viewport_size({'width':width,'height':390 if width==844 else 900});settled(page)
                                value=geometry();assert value['doc']<=width+1 and not value['over'] and abs(value['gap']-12)<1,(engine,language,theme,motion,value)
                                layouts+=1
                # Full-summary badges, including recovered unconfirmed records.
                page.evaluate("()=>{localStorage.setItem('castorice-language','en');localStorage.setItem('castorice-theme-mode','light')}")
                badge_cases=0
                for critical,warning,info,expected in ((0,0,0,''),(0,0,3,'dot'),(0,1,9,'1'),(0,9,9,'9'),(1,9,9,'10'),(40,59,5,'99'),(1,99,9,'99+')):
                    refresh()
                    storage.reconcile_alerts([])
                    with storage.connect() as db:db.execute('DELETE FROM alert_history');db.execute('DELETE FROM alert_state')
                    events=[{'id':f'badge-{severity}-{i}','severity':severity,'title':'Synthetic badge','description':'QA','source':'QA','time':stamp,'acknowledged':False} for severity,count in (('critical',critical),('warning',warning),('info',info)) for i in range(count)]
                    storage.reconcile_alerts(events)
                    for scale in (1,1.25,1.5,2):
                        page.reload(wait_until='networkidle');open_page(page,'connections','Active connections');page.set_viewport_size({'width':390,'height':844})
                        page.evaluate('value=>document.documentElement.style.fontSize=value+"px"',16*scale);settled(page)
                        badge=page.locator('.notification-badge')
                        if not expected:assert badge.count()==0
                        elif expected=='dot':assert badge.inner_text()=='' and 'notification-badge--dot' in badge.get_attribute('class')
                        else:
                            assert badge.inner_text()==expected
                            value=badge.evaluate('e=>{const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect();return {inside:t.top>=r.top&&t.bottom<=r.bottom&&t.left>=r.left&&t.right<=r.right}}')
                            assert value['inside'],(engine,scale,expected,value)
                        value=geometry();assert value['doc']<=value['width']+1 and not value['over'],(engine,scale,value)
                        badge_cases+=1
                # Remove text override before the shared page and dialog coverage.
                page.evaluate("()=>document.documentElement.style.fontSize=''")
                routes={'overview':'Synthetic QA','connections':'Active connections','traffic':'Traffic analytics','accounts':'Account status','subscriptions':'Subscription management','services':'Services','network':'Network quality','alerts':'Alerts','audit':'Audit log','setup':'Setup'}
                for route,heading in routes.items():
                    open_page(page,route,heading)
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(engine,route)
                open_page(page,'connections','Active connections')
                page.get_by_role('switch',name='Show live connections',exact=True).click();page.locator('.connection-disclosure').first.wait_for()
                open_page(page,'overview','Synthetic QA');open_page(page,'connections','Active connections')
                assert page.locator('.connection-disclosure').count()==0
                output_dir=ROOT/'outputs/browser/v57';output_dir.mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(output_dir/f'{engine}-connections-390.png'),full_page=True)
                assert not errors and not server_errors,(errors,server_errors)
                print(json.dumps({'connectionProduct':True,'passed':True,'engine':engine,'apiRoutesMocked':False,'layoutCases':layouts,'badgeCases':badge_cases,'populatedCounts':[0,1,50,100],'targetLifecycle':True,'searchSurvivesPolling':True,'stableGroupPolling':True,'routesPassed':10,'pageErrors':errors}),flush=True)
                context.close();browser.close()


if __name__=='__main__':main()
