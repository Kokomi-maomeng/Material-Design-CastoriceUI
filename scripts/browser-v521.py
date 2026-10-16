"""Traffic chart geometry regression using synthetic API data and real browsers."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def synthetic_chart_dashboard_from_empty(data):
    now=datetime.now(timezone.utc)
    points=[{'label':f'{index:02d}:00','capturedAt':(now-timedelta(hours=23-index)).isoformat(),'download':((index%4)+.5)*1_000_000_000,'upload':((index%3)+.2)*100_000_000} for index in range(24)]
    data.update(mode='live',generatedAt=now.isoformat())
    data['overview'].update(nodeName='QA node',cpuPercent=9,cpuCores=2,memoryPercent=42,memoryUsedBytes=420_000_000,memoryTotalBytes=1_000_000_000,diskPercent=25,diskUsedBytes=5_000_000_000,diskTotalBytes=20_000_000_000,trafficUsedBytes=100_000_000_000,trafficLimitBytes=1_000_000_000_000,interface='eth0',databaseWritable=True)
    data['traffic'].update(totalBytes=100_000_000_000,ranges={key:points for key in ['1h','6h','24h','3day','7day']},hourly=points)
    data['networkTargets']=[{'id':'qa-target','name':'QA target','provider':'Synthetic','address':'192.0.2.1','ipVersion':4,'latency':20,'jitter':.1,'loss':0,'status':'healthy','history':[20,21,19]}]
    data['uiSettings']['visiblePanels']=['alerts','accounts','subscriptions','services','network','connections','traffic','audit']
    return data


def measure(page):
    return page.locator('.chart--traffic svg').evaluate('''svg => {
      const rect=svg.getBoundingClientRect(), view=svg.viewBox.baseVal, matrix=svg.getScreenCTM();
      const label=svg.querySelector('.chart-axis-label');
      return {width:rect.width,height:rect.height,viewWidth:view.width,viewHeight:view.height,
        scaleX:matrix.a,scaleY:matrix.d,fontPixels:parseFloat(getComputedStyle(label).fontSize)*matrix.d,
        panelHeight:svg.closest('.md-card').getBoundingClientRect().height};
    }''')


def check_chart(page, case):
    page.locator('.chart--traffic svg').wait_for()
    # Observe several frames: the old ResizeObserver feedback drifts over time.
    page.wait_for_timeout(180)
    sizes=measure(page)
    assert .85 <= sizes['scaleX'] <= 1.15 and .85 <= sizes['scaleY'] <= 1.15, (case,sizes)
    assert 8 <= sizes['fontPixels'] <= 14, (case,sizes)
    assert abs(sizes['scaleX']-sizes['scaleY']) < .02, (case,sizes)
    assert abs(sizes['width']-sizes['viewWidth']) <= 2 and abs(sizes['height']-sizes['viewHeight']) <= 2, (case,sizes)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+2'), case
    svg=page.locator('.chart--traffic svg')
    svg.focus(); svg.press('End')
    assert page.locator('.chart-inspector').count()==1, case
    inspector=page.locator('.chart-inspector rect').bounding_box()
    box=svg.bounding_box()
    assert inspector['x'] >= box['x']-1 and inspector['x']+inspector['width'] <= box['x']+box['width']+1, (case,'tooltip clipped')
    svg.press('Home')
    assert page.locator('.chart-inspector').count()==1
    svg.hover(position={'x':box['width']*.7,'y':box['height']*.5})
    assert page.locator('.chart-inspector').count()==1
    page.wait_for_timeout(180)
    later=measure(page)
    assert abs(later['height']-sizes['height']) < 2 and abs(later['width']-sizes['width']) < 2, (case,'geometry drift',sizes,later)
    return sizes


def main():
    engines=sys.argv[1:] or ['chromium','firefox','webkit']
    with socket.socket() as available:
        available.bind(('127.0.0.1',0));port=available.getsockname()[1]
    origin=f'https://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='castorice-chart-') as folder:
        with (Path(folder)/'vite.log').open('w') as output:
            dev=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--port',str(port),'--strictPort'],cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                for _ in range(100):
                    try: urllib.request.urlopen(origin,context=ssl._create_unverified_context(),timeout=1).close();break
                    except OSError:
                        if dev.poll() is not None: raise RuntimeError('Chart test server exited')
                        time.sleep(.1)
                else: raise TimeoutError('Chart test server did not start')
                cases=[]
                with sync_playwright() as playwright:
                    for engine in engines:
                        browser=getattr(playwright,engine).launch()
                        try:
                            for language,theme in [('zh','dark'),('en','light')]:
                                context=browser.new_context(ignore_https_errors=True,viewport={'width':1536,'height':639},reduced_motion='reduce')
                                context.add_init_script('localStorage.setItem("castorice-language",'+json.dumps(language)+');localStorage.setItem("castorice-theme-mode",'+json.dumps(theme)+')')
                                page=context.new_page();errors=[]
                                page.on('pageerror',lambda error: errors.append(str(error)))
                                # Do not wait for a network-idle event on an inert
                                # fixture page: fonts/TLS can keep WebKit waiting.
                                page.goto(origin+'/scripts/browser-fixture.html',wait_until='domcontentloaded')
                                data=page.evaluate("async()=>structuredClone((await import('/lib/empty-dashboard.ts')).emptyDashboard)")
                                data=synthetic_chart_dashboard_from_empty(data)
                                original_ranges=dict(data['traffic']['ranges'])
                                def route_api(route):
                                    path=route.request.url.split('/api/v2/',1)[1].split('?',1)[0]
                                    payload={'bootstrap':{'setupRequired':False,'bootstrapAvailable':False,'appearance':{'type':'default','url':'','fit':'cover'}},'auth/session':{'username':'QA','csrfToken':'synthetic-csrf','expiresAt':int(time.time())+3600,'setupComplete':True},'dashboard':data}.get(path,{})
                                    route.fulfill(json=payload)
                                context.route('**/api/v2/**',route_api)
                                for width,height in [(1536,639),(390,844),(2560,1440),(320,700),(1440,1000)]:
                                    page.set_viewport_size({'width':width,'height':height})
                                    for section in ['overview','traffic']:
                                        page.goto(origin+'/#/'+section,wait_until='networkidle')
                                        geometry=[]
                                        for label in ['24h','1h','6h','3d','7d']:
                                            page.locator('.traffic-range-control').get_by_role('button',name=label,exact=True).click()
                                            case={'engine':engine,'language':language,'theme':theme,'width':width,'section':section,'range':label}
                                            geometry.append(check_chart(page,case))
                                        cases.append({**case,'ranges':5,'geometry':geometry[-1]})
                                        if os.environ.get('CASTORICEUI_QA_SCREENSHOTS') and language=='zh':
                                            shots=Path(os.environ['CASTORICEUI_QA_SCREENSHOTS']);shots.mkdir(parents=True,exist_ok=True)
                                            page.evaluate('scrollTo(0,0)')
                                            page.screenshot(path=str(shots/f'chart-{engine}-{section}-{width}.png'),full_page=True)
                                # Initial empty data and one-point data must mount and resize correctly.
                                for count in [0,1,24]:
                                    data['traffic']['ranges']={key:points[:count] for key,points in original_ranges.items()}
                                    page.goto(origin+'/#/overview',wait_until='networkidle')
                                    if count: check_chart(page,{'engine':engine,'count':count})
                                    else: page.locator('.chart-empty').wait_for()
                                assert not errors, errors
                                context.close()
                        finally: browser.close()
                print(json.dumps({'chartCases':cases,'syntheticApiFixture':True,'pageErrors':0}))
            finally:
                dev.terminate()
                try:dev.wait(10)
                except subprocess.TimeoutExpired:dev.kill();dev.wait()


if __name__=='__main__':main()
