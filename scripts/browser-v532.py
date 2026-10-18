"""Measure animation frames and interaction state against synthetic API routes."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright
from browser_fixture import empty_dashboard

BASE = os.environ.get('CASTORICEUI_BROWSER_URL', 'https://127.0.0.1:5173').rstrip('/')
spec = importlib.util.spec_from_file_location('background_fixture', Path(__file__).with_name('browser-v50.py'))
background_fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(background_fixture)


def settled(page):
    page.evaluate("""async()=>{await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}""")


def frames(locator, click, reduced):
    # Sample the browser's actual CSS/WAAPI interpolation at fixed timeline
    # positions. A busy headless runner can paint fewer than three frames in
    # 300ms; pausing the native animations keeps that scheduling out of the test.
    # No keyframes, durations, styles or target geometry are replaced.
    locator.evaluate("""e=>{
      const state={animations:[],originalAnimate:e.animate};
      const capture=a=>{if(!state.animations.includes(a)){a.pause();state.animations.push(a)}};
      state.onRun=event=>{if(event.target===e)e.getAnimations().forEach(capture)};
      e.animate=function(...args){const a=state.originalAnimate.apply(this,args);capture(a);return a};
      e.addEventListener('transitionrun',state.onRun);e.__motionQA=state;
    }""")
    try:
        click()
        return locator.evaluate("""async(e,reduced)=>{
          const state=e.__motionQA,deadline=performance.now()+3000;
          while(!reduced&&!state.animations.length&&performance.now()<deadline)await new Promise(requestAnimationFrame);
          if(!reduced&&!state.animations.length)throw new Error('Expected a native browser animation');
          const duration=Math.max(0,...state.animations.map(a=>{const t=a.effect.getTiming();return Number(t.delay)+Number(t.duration)}));
          const rows=[];
          for(const progress of reduced?[1]:[0,.25,.5,.75,.96]){
            for(const a of state.animations)a.currentTime=duration*progress;
            await new Promise(requestAnimationFrame);
            const style=getComputedStyle(e);
            rows.push({progress,height:e.getBoundingClientRect().height,opacity:Number(style.opacity),marginLeft:parseFloat(style.marginLeft)||0});
          }
          return rows;
        }""", reduced)
    finally:
        locator.evaluate("""async e=>{const s=e.__motionQA;e.removeEventListener('transitionrun',s.onRun);e.animate=s.originalAnimate;
          for(const a of s.animations)a.finish();
          await Promise.all(s.animations.map(a=>a.finished.catch(()=>{})));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));delete e.__motionQA;
        }""")


def moving(rows, label):
    heights = [r['height'] for r in rows]
    assert max(heights) - min(heights) > 4, (label, rows)
    assert len({round(h, 1) for h in heights}) >= 3, (label, 'no intermediate frames', rows)


def run(engine, browser):
    cases = []
    for width in (1440, 390):
      for reduced in (False, True):
        context = browser.new_context(ignore_https_errors=True, viewport={'width': width, 'height': 960}, reduced_motion='reduce' if reduced else 'no-preference')
        context.add_init_script("localStorage.setItem('castorice-language','en');localStorage.setItem('castorice-theme-mode','dark')")
        page = context.new_page(); errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
        dashboard = empty_dashboard(context, page, BASE)
        dashboard.update(mode='live', generatedAt='2026-01-01T00:00:00Z')
        dashboard['overview']['nodeName'] = 'Motion QA'
        dashboard['uiSettings']['visiblePanels'] = ['alerts','accounts','subscriptions','services','network','connections','traffic','audit']
        state = {'authenticated': True, 'backgrounds': 0, 'bootstraps': 0, 'logoutFailure': False, 'settingsWrites': 0}
        appearance = {'type':'url','url':'/api/v2/auth/background','fit':'cover','cacheSeconds':2,'glass':'clear','glassEnabled':False,'revision':'motion-v532'}

        def route_api(route):
            path = urlsplit(route.request.url).path.removeprefix('/api/v2/')
            if path == 'auth/background':
                state['backgrounds'] += 1
                route.fulfill(body=background_fixture.image(1), content_type='image/png'); return
            if path == 'bootstrap':
                state['bootstraps'] += 1
                data = {'setupRequired':False,'bootstrapAvailable':False,'appearance':appearance}
            elif path == 'auth/logout':
                if state['logoutFailure']: route.fulfill(status=503, json={'error':'service_unavailable'}); return
                state['authenticated'] = False; data = {'ok': True}
            elif path == 'auth/session' and not state['authenticated']:
                route.fulfill(status=401, json={'error':'authentication_required'}); return
            elif path.startswith('auth/'):
                state['authenticated'] = True
                data = {'username':'qa-admin','csrfToken':'synthetic','expiresAt':int(time.time())+3600,'setupComplete':True}
            elif path == 'dashboard': data = dashboard
            elif path == 'settings/background-options':
                data = {'files':['synthetic.png'],'directory':'/var/lib/castoriceui/login-backgrounds','selected':appearance,'configured':{**appearance,'value':'https://images.example.com/random'}}
            elif path.startswith('settings/'):
                state['settingsWrites'] += 1; data = {}
            else: data = {'items':[],'total':0,'page':1,'pageSize':30,'totalPages':1}
            route.fulfill(json=data)

        context.route('**/api/v2/**', route_api)
        page.goto(BASE, wait_until='networkidle'); page.get_by_role('heading', name='Motion QA', exact=True).wait_for(); settled(page)
        if width <= 900: page.get_by_role('button', name='Open navigation', exact=True).click()
        page.get_by_role('button', name='Settings', exact=True).click()
        details = page.locator('.settings-disclosure').filter(has=page.get_by_text('Sign-in background', exact=True))
        opening = frames(details, lambda: details.locator('summary').click(), reduced)
        if not reduced: moving(opening, 'native disclosure opening')
        settled(page)
        toggle = page.get_by_role('switch', name='Liquid Glass', exact=True)
        collapse = page.locator('.glass-settings > .motion-collapse')
        expansion = frames(collapse, lambda: toggle.click(), reduced)
        if not reduced: moving(expansion, 'glass expansion')
        slider = page.get_by_role('slider', name='Glass transparency', exact=True)
        slider.fill('2')
        closing = frames(collapse, lambda: toggle.click(), reduced)
        if not reduced: moving(closing, 'glass collapse')
        expect(slider).to_have_count(0)
        assert collapse.get_attribute('inert') is not None
        toggle.click(); expect(slider).to_have_value('2'); settled(page)
        # Reverse the same control before its CSS transition has finished.
        toggle.click(); toggle.click(); expect(slider).to_have_value('2'); settled(page)
        collapse_details = frames(details, lambda: details.locator('summary').click(), reduced)
        if not reduced: moving(collapse_details, 'native disclosure closing')
        assert not details.evaluate('e=>e.open')
        details.locator('summary').press('Enter'); settled(page); assert details.evaluate('e=>e.open')
        details.locator('summary').click(); details.locator('summary').click(); settled(page)
        assert details.evaluate('e=>e.open')
        source = page.get_by_role('button', name='Sign-in background source', exact=True)
        source.click(); page.get_by_role('option', name='Default Material background', exact=True).click(); settled(page)
        expect(toggle).to_have_count(0)
        source.click(); page.get_by_role('option', name='Server image', exact=True).click(); settled(page)
        expect(page.get_by_role('button', name='Allowed image', exact=True)).to_be_visible()
        expect(toggle).to_have_attribute('aria-checked','false')
        page.get_by_role('button', name='Close', exact=True).click(); page.locator('.md-dialog-layer').wait_for(state='detached')
        if width <= 900: page.get_by_role('button', name='Close navigation', exact=True).press('Enter')
        page.get_by_role('button', name='Edit traffic quota', exact=True).click()
        reset = page.get_by_role('switch', name='Automatic traffic reset', exact=True)
        if reset.get_attribute('aria-checked') == 'true': reset.click(); settled(page)
        schedule = page.locator('.quota-dialog .motion-collapse'); schedule_rows = frames(schedule, lambda: reset.click(), reduced)
        if not reduced: moving(schedule_rows, 'quota schedule')
        reset.click(); assert schedule.get_attribute('aria-hidden') == 'true'; settled(page)
        page.get_by_role('button', name='Cancel', exact=True).click(); page.locator('.md-dialog-layer').wait_for(state='detached')
        # Every route keeps the existing entrance animation and its exact heading.
        routes = [('overview','Motion QA'),('accounts','Account status'),('connections','Active connections'),('traffic','Traffic analytics'),('subscriptions','Subscription management'),('network','Network quality'),('services','Services'),('alerts','Alerts'),('setup','Setup'),('audit','Audit log')]
        for route, heading in routes:
            if width <= 900: page.get_by_role('button', name='Open navigation', exact=True).click()
            nav = page.locator('.navigation-rail nav button').filter(has_text={'accounts':'Account status','connections':'Connections','traffic':'Traffic','subscriptions':'Subscriptions','network':'Network','services':'Services','alerts':'Alerts','audit':'Audit','setup':'Setup','overview':'Overview'}[route])
            nav.click(); page.get_by_role('heading', name=heading, exact=True).wait_for(); settled(page)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), (route, width, 'document overflow')
            assert page.locator('.page-content').evaluate('e=>getComputedStyle(e).animationName') == 'page-enter'
        if width > 900:
            sidebar = page.get_by_role('button', name='Hide sidebar', exact=True)
            margins = [r['marginLeft'] for r in frames(page.locator('.app-main'), lambda: sidebar.click(), reduced)]
            if not reduced: assert len({round(v,1) for v in margins}) >= 3, margins
            page.get_by_role('button', name='Show sidebar', exact=True).click(); settled(page)
        state['logoutFailure'] = True
        page.locator('.user-menu').click(); page.get_by_role('menuitem', name='Sign out', exact=True).click()
        page.get_by_role('status').filter(has_text='The server did not confirm').wait_for(); settled(page)
        assert page.locator('.app-shell').get_attribute('inert') is None
        assert page.locator('.app-shell').evaluate('e=>Number(getComputedStyle(e).opacity)') == 1
        expect(page.get_by_role('heading', name='Audit log', exact=True)).to_be_visible()
        state['logoutFailure'] = False
        count = (state['backgrounds'], state['bootstraps'])
        page.locator('.user-menu').click(); page.get_by_role('menuitem', name='Sign out', exact=True).click()
        page.get_by_role('heading', name='Welcome back', exact=True).wait_for()
        assert page.locator('.app-shell').count() == 0, 'old authenticated DOM retained after logout'
        assert count == (state['backgrounds'], state['bootstraps']), 'logout reloaded image/bootstrap'
        assert page.locator('.auth-page').evaluate('e=>e.style.backgroundImage.includes("blob:")')
        assert page.locator('.auth-card').evaluate('e=>getComputedStyle(e).animationName') == ('none' if reduced else 'auth-card-enter')
        settled(page)
        page.get_by_role('textbox', name='Username', exact=True).fill('qa-admin')
        page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_role('heading', name='Motion QA', exact=True).wait_for(); settled(page)
        assert page.url.endswith('#/overview'), 'URL and rendered destination diverged after signing in again'
        assert not errors, errors
        assert state['settingsWrites'] == 0
        cases.append({'width':width,'reducedMotion':reduced,'routes':len(routes),'frameMeasurement':'native-browser-timeline','glassIntermediateFrames':len({round(r['height'],1) for r in expansion}),'nativeSummaryKeyboard':True,'rapidReversal':True,'failedSignOutRestoresScreen':True,'logoutRemovesPrivateDom':True,'logoutKeepsDocumentImage':True,'postLoginOverview':True,'settingsWrites':0})
        print(f'motion case passed: {engine}, {width}px, reduced={reduced}', file=sys.stderr, flush=True)
        context.close()
    print(json.dumps({'engine':engine,'motionCases':cases,'passed':True,'pageErrors':0,'apiRoutesMocked':True}))


if __name__ == '__main__':
    with sync_playwright() as runtime:
        for engine in sys.argv[1:] or ['chromium','firefox','webkit']:
            browser = getattr(runtime, engine).launch()
            try: run(engine, browser)
            finally: browser.close()
