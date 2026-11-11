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
from playwright.sync_api import expect, sync_playwright
from qa_browser import settled, open_page, frames

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
                open_page(page,'traffic/connections','Traffic analytics')
                assert not requests and page.locator('.connection-detail-panel').count()==0
                def geometry():
                    # Inline boxes have clientWidth=0 in Firefox despite painted
                    # text fitting their parent. Measure every real client box,
                    # including inline-flex chips/rates, and retain diagnostics.
                    return page.evaluate('''()=>{const cards=[...document.querySelectorAll('.connection-card')];const over=[...document.querySelectorAll('.active-connections *')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width&&r.height&&e.clientWidth>0&&s.display!=='none'&&e.scrollWidth>e.clientWidth+2&&!e.closest('[inert]')}).map(e=>({tag:e.tagName,className:String(e.className),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,display:getComputedStyle(e).display,text:e.textContent.slice(0,80)}));return {width:innerWidth,doc:document.documentElement.scrollWidth,over,gap:cards.length>1?cards[1].getBoundingClientRect().top-cards[0].getBoundingClientRect().bottom:0}}''')
                # Hidden 0/1/50/100 streams must not create spacing or focus targets.
                for count in (0,1,50,100):
                    refresh(count);page.reload(wait_until='networkidle');open_page(page,'traffic/connections','Traffic analytics')
                    assert page.locator('.connection-detail-panel').count()==0
                    value=geometry();assert value['doc']<=value['width']+1 and not value['over'],value
                    if count:assert abs(value['gap']-8)<1,value
                live=page.get_by_role('button',name='Live connections',exact=True)
                filter_button=page.get_by_role('button',name='Filter',exact=True)
                section=page.locator('.active-connections > .motion-collapse')
                close_rows=frames(section,live.click,False)
                assert len({round(row['height'],1) for row in close_rows})>=3,close_rows
                expect(filter_button).to_have_count(0)
                open_rows=frames(section,live.click,False)
                assert len({round(row['height'],1) for row in open_rows})>=3,open_rows
                expect(filter_button).to_be_visible()
                timings=page.locator('.traffic-section > .motion-collapse').evaluate_all('nodes=>nodes.map(e=>getComputedStyle(e).transition)')
                assert len(timings)==2 and timings[0]==timings[1],timings
                settled(page)
                arrow_positions=page.locator('.traffic-section .traffic-analysis__toggle > span').evaluate_all("""arrows=>arrows.map(e=>{
                  const arrow=e.getBoundingClientRect(),header=e.closest('.traffic-analysis__header').getBoundingClientRect();
                  return {width:arrow.width,inset:header.right-arrow.right};
                })""")
                assert len(arrow_positions)==2 and all(position['width']>10 and 10<=position['inset']<=20 for position in arrow_positions),arrow_positions
                assert not requests
                assert page.get_by_text('About these measurements',exact=True).count() == 0
                filter_motion=page.locator('.connection-filters-collapse')
                motion_rows=frames(filter_motion,lambda:page.get_by_role('button',name='Filter',exact=True).click(),False)
                assert len({round(row['height'],1) for row in motion_rows})>=3,motion_rows
                assert filter_motion.get_attribute('aria-hidden')=='false'
                assert float(filter_motion.evaluate("e=>getComputedStyle(e).transitionDuration.split(',')[0].replace('s','')"))>0
                page.get_by_role('searchbox',name='Destination domain',exact=True).fill('draft-kept')
                page.get_by_role('button',name='Filters applied',exact=True).click()
                assert filter_motion.get_attribute('aria-hidden')=='true'
                page.get_by_role('button',name='Filters applied',exact=True).click()
                assert page.get_by_role('searchbox',name='Destination domain',exact=True).input_value()=='draft-kept'
                page.get_by_role('button',name='Clear filters',exact=True).first.click()
                page.get_by_role('button',name='Filter',exact=True).click()
                toggle=page.get_by_role('button',name='Hysteria2 connection details',exact=True)
                another=page.get_by_role('button',name='AnyTLS connection details',exact=True)
                toggle.press('Enter')
                disclosure=page.locator('.connection-detail-panel').first
                expect(disclosure.locator('.connection-target')).to_have_count(10)
                settled(page)
                expect(toggle).to_have_attribute('aria-expanded','true')
                expect(another).to_have_attribute('aria-expanded','false')
                expect(page.locator('.connection-detail-panel')).to_have_count(1)
                assert all('[' not in value and ']' not in value for value in page.locator('.connection-target code').all_text_contents())
                assert page.locator('.connection-port').first.inner_text() == 'Port 443'
                assert page.locator('.connection-target-list').first.locator('li').count()==10
                toggle.press('Enter')
                expect(disclosure).to_have_count(0)
                another.click()
                expect(page.locator('.connection-target')).to_have_count(1)
                expect(toggle).to_have_attribute('aria-expanded','false')
                another.click()
                expect(disclosure).to_have_count(0)
                toggle.press('Enter')
                expect(disclosure.locator('.connection-target')).to_have_count(10)
                settled(page)
                # Keep an observed row through closure even when live rows
                # would otherwise push it beyond the ten-row page.
                refresh(99)
                expect(disclosure.locator('.connection-target.is-closed')).to_have_count(1, timeout=10000)
                expect(disclosure.locator('.connection-target')).to_have_count(11)
                assert 'target-0-99.' in disclosure.locator('.connection-target.is-closed code').inner_text()
                refresh(100)
                expect(disclosure.locator('.connection-target.is-closed')).to_have_count(0, timeout=10000)
                expect(disclosure.locator('.connection-target')).to_have_count(10)
                disclosure.get_by_role('searchbox').fill('target-0-99.')
                assert disclosure.locator('.connection-target').count()==1
                refresh(3)
                disclosure.locator('.connection-countdown').wait_for()
                retained_at=time.monotonic()
                assert 'Closed' in disclosure.locator('.connection-target-meta').inner_text()
                assert 'Open for' not in disclosure.locator('.connection-target-meta').inner_text()
                page.get_by_text('No matching destinations',exact=True).wait_for(timeout=38000)
                assert time.monotonic()-retained_at>=28
                assert disclosure.get_by_role('searchbox').input_value()=='target-0-99.'
                disclosure.get_by_role('searchbox').fill('')
                assert disclosure.locator('.connection-target').count()==3
                refresh(100)
                page.get_by_text('100 connections',exact=True).wait_for()
                disclosure.get_by_role('searchbox').wait_for(state='visible')
                disclosure.get_by_role('searchbox').fill('')
                disclosure.get_by_role('button',name='Show 10 more',exact=True).click()
                expect(disclosure.locator('.connection-target')).to_have_count(20)
                # Finish the animated 10-to-20 row expansion and native scroll
                # anchoring before targeting a button outside the current view.
                settled(page)
                copied=disclosure.locator('.connection-target code').first.text_content()
                page.evaluate("""()=>{window.qaCopied='';window.qaCopyEvents=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.qaCopied=value}}});
                  for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{const b=event.target.closest?.('.copy-ip-button');if(b)window.qaCopyEvents.push({type,label:b.getAttribute('aria-label'),trusted:event.isTrusted})},true)}""")
                disclosure.get_by_role('button',name=f'Copy destination address {copied}',exact=True).click()
                try:page.wait_for_function('(expected)=>window.qaCopied===expected',arg=copied)
                except Exception:
                    diagnostic=page.evaluate("""()=>({actual:window.qaCopied,secure:window.isSecureContext,events:window.qaCopyEvents,active:document.activeElement?.getAttribute('aria-label'),toast:document.querySelector('.toast')?.textContent,animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>({target:a.effect?.target?.className,duration:a.effect?.getTiming().duration}))})""")
                    print(json.dumps({'clipboardFailure':diagnostic,'expected':copied,'pageErrors':errors}),flush=True)
                    raise
                first_id=page.locator('.connection-card').first.get_attribute('data-connection-id')
                page.evaluate("""()=>{window.qaFirstFlow=document.querySelector('.connection-target');window.qaFlowOrder=[...document.querySelectorAll('.connection-target code')].map(e=>e.textContent);
                  window.qaListMotion=[];document.addEventListener('animationstart',e=>{if(e.target.matches('.connection-list,.connection-card,.connection-target-list,.connection-target'))window.qaListMotion.push(e.animationName)})}""")
                with page.expect_response('**/api/v2/connections/targets',timeout=12000):
                    with dashboard.lock:
                        dashboard.runtime_cache['connections'].reverse()
                        for group in dashboard.runtime_cache['connections']:
                            for row in group['details']:
                                row['downloadBps']=10000 if row['downloadBps']==0 else 1
                expect(disclosure.get_by_text('↓ 1 B/s',exact=True).first).to_be_visible()
                assert page.locator('.connection-card').first.get_attribute('data-connection-id')==first_id
                assert page.evaluate("""()=>window.qaFirstFlow===document.querySelector('.connection-target')&&JSON.stringify(window.qaFlowOrder)===JSON.stringify([...document.querySelectorAll('.connection-target code')].map(e=>e.textContent))&&window.qaListMotion.length===0&&document.querySelectorAll('.connection-list .record-transition').length===0""")
                expect(toggle).to_have_attribute('aria-expanded','true')
                with dashboard.lock:dashboard.runtime_cache['connections'].reverse()
                toggle.click()
                disclosure.wait_for(state='detached')
                assert page.locator('.connection-target').count()==0
                page.get_by_role('button',name='Filter',exact=True).click();settled(page)
                filter_panel = page.locator('.connection-filters')
                def filter_bounds():
                    return filter_panel.evaluate("""e=>[e, ...e.querySelectorAll('input, button')].map(node=>{
                      const r=node.getBoundingClientRect();return [r.left, r.top+scrollY, r.width, r.height]
                    })""")
                before = filter_bounds()
                page.get_by_role('button',name='Source IP',exact=True).click()
                page.get_by_role('option',name='IPv4',exact=True).click();settled(page)
                page.get_by_role('button',name='Protocol',exact=True).click();page.get_by_role('option',name='Hysteria2',exact=True).click();settled(page)
                page.get_by_text('No connections match these filters',exact=True).wait_for()
                after = filter_bounds()
                assert all(abs(a-b)<1 for original,current in zip(before,after,strict=True) for a,b in zip(original,current,strict=True)), (engine, 'filters moved on an empty result', before, after)
                page.get_by_role('button',name='Clear filters',exact=True).first.click()
                page.get_by_role('searchbox',name='Destination domain',exact=True).fill('target-0-99.')
                page.wait_for_function('document.querySelectorAll(".connection-card").length===1')
                settled(page)
                before = filter_bounds()
                domain_mode = page.get_by_role('button',name='Exact match for destination domain',exact=True)
                domain_mode.click()
                expect(domain_mode).to_have_attribute('aria-pressed','true')
                page.get_by_text('No connections match these filters',exact=True).wait_for()
                settled(page)
                assert all(abs(a-b)<1 for original,current in zip(before,filter_bounds(),strict=True) for a,b in zip(original,current,strict=True)), (engine, 'exact matching moved the fields')
                domain_mode.click()
                expect(domain_mode).to_have_attribute('aria-pressed','false')
                expect(page.locator('.connection-card')).to_have_count(1)
                page.get_by_role('button',name='Clear filters',exact=True).first.click()
                page.get_by_role('searchbox',name='IP address',exact=True).fill('192.0.2.3')
                ip_mode = page.get_by_role('button',name='Exact match for IP address',exact=True)
                ip_mode.click()
                expect(ip_mode).to_have_attribute('aria-pressed','true')
                page.wait_for_function('document.querySelectorAll(".connection-card").length===1')
                page.get_by_role('searchbox',name='Destination port',exact=True).fill('8443')
                page.get_by_text('No connections match these filters',exact=True).wait_for()
                page.get_by_role('button',name='Clear filters',exact=True).first.click()
                page.get_by_role('button',name='Filter',exact=True).click()
                layouts=0
                for language in ('en','zh'):
                    for theme in ('light','dark'):
                        refresh()
                        page.evaluate('v=>{localStorage.setItem("castorice-language",v[0]);localStorage.setItem("castorice-theme-mode",v[1])}',[language,theme])
                        page.reload(wait_until='networkidle');open_page(page,'traffic/connections','Traffic analytics' if language=='en' else '流量分析')
                        for motion in ('reduce','no-preference'):
                            page.emulate_media(reduced_motion=motion)
                            for width in WIDTHS:
                                page.set_viewport_size({'width':width,'height':390 if width==844 else 900});settled(page)
                                value=geometry();assert value['doc']<=width+1 and not value['over'] and abs(value['gap']-8)<1,(engine,language,theme,motion,value)
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
                        page.reload(wait_until='networkidle');open_page(page,'traffic/connections','Traffic analytics');page.set_viewport_size({'width':390,'height':844})
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
                routes={'overview':'Synthetic QA','traffic/connections':'Traffic analytics','traffic':'Traffic analytics','accounts':'Account management','services':'Services','network':'Network quality','alerts':'Alerts','audit':'Audit center','setup':'Setup'}
                for route,heading in routes.items():
                    open_page(page,route,heading)
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(engine,route)
                open_page(page,'traffic/connections','Traffic analytics')
                page.evaluate("location.hash='/connections'")
                page.wait_for_function("location.hash === '#/traffic/connections'")
                expect(page.get_by_role('heading',name='Live connections',exact=True)).to_be_focused()
                page.get_by_role('button',name='Hysteria2 connection details',exact=True).click();page.locator('.connection-detail-panel').first.wait_for()
                open_page(page,'overview','Synthetic QA');open_page(page,'traffic/connections','Traffic analytics')
                assert page.locator('.connection-detail-panel').count()==0
                output_dir=ROOT/'outputs/browser/v57';output_dir.mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(output_dir/f'{engine}-connections-390.png'),full_page=True)
                assert not errors and not server_errors,(errors,server_errors)
                print(json.dumps({'connectionProduct':True,'passed':True,'engine':engine,'apiRoutesMocked':False,'layoutCases':layouts,'badgeCases':badge_cases,'populatedCounts':[0,1,50,100],'targetLifecycle':True,'closedRetentionSeconds':30,'closedRowStaysOnPage':True,'filtersRetainDraft':True,'addressMatchModes':True,'defaultTargetsCollapsed':True,'independentGroups':True,'sharedSectionMotion':True,'searchSurvivesPolling':True,'stableGroupPolling':True,'routesPassed':len(routes),'pageErrors':errors}),flush=True)
                context.close();browser.close()


if __name__=='__main__':main()
