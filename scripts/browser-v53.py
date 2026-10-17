"""Real-engine cache lifecycle, lens rendering and scoped settings acceptance."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright
from browser_fixture import empty_dashboard

sys.path.insert(0, str(Path(__file__).parent))
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location('v50', Path(__file__).with_name('browser-v50.py'))
v50 = module_from_spec(spec); spec.loader.exec_module(v50)

BASE = os.environ.get('CASTORICEUI_BROWSER_URL', 'https://127.0.0.1:5173').rstrip('/')
SHOTS = Path(os.environ['CASTORICEUI_QA_SHOTS']) if os.environ.get('CASTORICEUI_QA_SHOTS') else None


def run(engine, context):
    context.add_init_script("""localStorage.setItem('castorice-language','en');
      const qaRealNow=Date.now,qaRealOrigin=performance.timeOrigin;Date.now=()=>Number(localStorage.getItem('qaBackgroundNow'))||qaRealNow();
      Object.defineProperty(performance,'timeOrigin',{get:()=>Number(localStorage.getItem('qaBackgroundNow'))||qaRealOrigin});
      window.__qaBackgrounds=[]; new MutationObserver(()=>{const s=document.querySelector('.auth-page')?.style.backgroundImage;
      if(s?.includes('blob:') && window.__qaBackgrounds.at(-1)!==s)window.__qaBackgrounds.push(s)}).observe(document,{attributes:true,childList:true,subtree:true});""")
    page = context.new_page(); errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    dashboard = empty_dashboard(context, page, BASE)
    dashboard.update(mode='live', generatedAt='2026-01-01T00:00:00Z')
    appearance = {'type': 'default', 'url': '', 'fit': 'cover', 'cacheSeconds': 0, 'glass': 'clear', 'glassEnabled': True, 'revision': 'v53-default'}
    state = {'authenticated': False, 'requests': 0, 'hold': False, 'fail': False, 'corrupt': False, 'stale': False, 'bootstrapRequests': 0}

    def route_api(route):
        path = urlsplit(route.request.url).path.removeprefix('/api/v2/')
        if path == 'auth/background':
            state['requests'] += 1
            assert 'cookie' not in route.request.headers
            if state['hold']: state['held'] = route; return
            if state['fail']: route.fulfill(status=503, json={'error': 'background_temporarily_unavailable'}, headers={'Retry-After': '2'}); return
            if state['corrupt']:
                state['corrupt'] = False
                route.fulfill(body=b'corrupt', content_type='image/png'); return
            deliver(route); return
        if path == 'bootstrap':
            state['bootstrapRequests'] += 1
            data = {'setupRequired': False, 'bootstrapAvailable': False, 'appearance': appearance}
        elif path == 'auth/session' and not state['authenticated']:
            route.fulfill(status=401, json={'error': 'authentication_required'}); return
        elif path == 'auth/logout': state['authenticated'] = False; data = {'ok': True}
        elif path.startswith('auth/'):
            state['authenticated'] = True; data = {'username': 'qa-admin', 'csrfToken': 'synthetic', 'expiresAt': int(time.time()) + 3600, 'setupComplete': True}
        elif path == 'dashboard': data = dashboard
        elif path == 'settings/background-options': data = {'files': ['synthetic.png'], 'directory': '/var/lib/castoriceui/login-backgrounds', 'selected': appearance, 'configured': {**appearance, 'value': 'https://images.example.com/random' if appearance['type'] == 'url' else ''}}
        elif path == 'settings/login-background':
            state['saved'] = route.request.post_data_json; appearance.update(state['saved']); appearance['revision'] = 'v53-saved'; data = appearance
        else: data = {'items': [], 'total': 0, 'page': 1, 'pageSize': 30, 'totalPages': 1}
        route.fulfill(json=data)

    def deliver(route):
        route.fulfill(body=v50.image(state['requests']), content_type='image/png', headers={'Cache-Control': 'no-store', 'X-Background-Age': '30' if state['stale'] else '0', 'X-Background-Stale': '1' if state['stale'] else '0'})

    context.route('**/api/v2/**', route_api)
    def policy(route):
        response = route.fetch(); route.fulfill(response=response, headers={**response.headers, 'Content-Security-Policy': "img-src 'self' data: blob:"})
    context.route(BASE + '/', policy)
    page.goto(BASE, wait_until='networkidle')
    page.get_by_role('heading', name='Welcome back', exact=True).wait_for(timeout=20000)
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'solid'); assert state['requests'] == 0
    appearance.update(type='url', url='/api/v2/auth/background', glassEnabled=False, revision='v53-images')
    page.reload(wait_until='networkidle'); page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage.includes('blob:')")
    expect(page.locator('.auth-card')).to_have_attribute('data-glass', 'solid')

    # Probe storage independently: some WebKit temporary profiles lose Cache API
    # entries across navigation. That limitation must not weaken no-flash checks.
    page.evaluate("async()=>{await(await caches.open('castorice-v53-probe')).put('/qa-probe',new Response('persisted'))}")
    state['hold'] = True; previous_count = state['requests']; state.pop('held', None)
    page.reload(wait_until='domcontentloaded'); page.locator('.auth-card').wait_for()
    page.wait_for_function("document.querySelector('.auth-input')")
    page.wait_for_timeout(150)
    assert state.get('held'), 'new no-cache visit did not request an image'
    assert page.evaluate('window.__qaBackgrounds.length') == 0, 'expired image flashed before response'
    persistent = page.evaluate("async()=>!!(await(await caches.open('castorice-v53-probe')).match('/qa-probe'))")
    deliver(state.pop('held')); state['hold'] = False
    page.wait_for_function("window.__qaBackgrounds.length===1")
    assert state['requests'] == previous_count + 1

    # Freeze only Date.now for an exact cache boundary. Slow WebKit navigation
    # can otherwise consume the entire two-second TTL before a reload starts.
    page.evaluate("localStorage.setItem('qaBackgroundNow',String(Date.now()))")
    appearance['cacheSeconds'] = 2; appearance['revision'] = 'v53-two-seconds'
    page.reload(wait_until='networkidle'); page.wait_for_function('window.__qaBackgrounds.length===1')
    page.wait_for_function("async()=>!!(await(await caches.open('castorice-login-background-v7')).match('/api/v2/auth/background?profile=landscape-1920&revision=v53-two-seconds'))")
    count = state['requests']; page.reload(wait_until='networkidle'); page.wait_for_function('window.__qaBackgrounds.length===1')
    assert state['requests'] == count + (0 if persistent else 1), (engine, persistent, count, state['requests'])
    page.evaluate("localStorage.setItem('qaBackgroundNow',String(Date.now()+2100))")
    state['hold'] = True; state.pop('held', None)
    page.reload(wait_until='domcontentloaded'); page.locator('.auth-card').wait_for(); page.wait_for_timeout(150)
    assert state.get('held') and page.evaluate('window.__qaBackgrounds.length') == 0
    deliver(state.pop('held')); state['hold'] = False
    page.wait_for_function('window.__qaBackgrounds.length===1')
    count = state['requests']; page.wait_for_timeout(2400)
    assert state['requests'] == count and page.evaluate('window.__qaBackgrounds.length') == 1

    # Login/logout are not document navigations, even beyond the two-second TTL.
    # Assert the very first inserted login-page DOM already has its image.
    retained = page.locator('.auth-page').evaluate('e=>e.style.backgroundImage')
    bootstraps = state['bootstrapRequests']
    for cycle in range(2):
        page.get_by_role('textbox', name='Username', exact=True).fill('qa-admin')
        page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.locator('.user-menu').wait_for()
        page.evaluate("localStorage.setItem('qaBackgroundNow',String(Date.now()+5000));window.__qaLogoutPaint=[];window.__qaLogoutObserver=new MutationObserver(()=>{const e=document.querySelector('.auth-page');if(e)window.__qaLogoutPaint.push(e.style.backgroundImage)});window.__qaLogoutObserver.observe(document,{childList:true,subtree:true,attributes:true})")
        page.locator('.user-menu').click()
        page.get_by_role('menuitem', name='Sign out', exact=True).click()
        page.locator('.auth-page').wait_for()
        assert page.locator('.auth-page').evaluate('e=>e.style.backgroundImage') == retained
        assert page.evaluate('window.__qaLogoutPaint.every(s=>s===document.querySelector(".auth-page").style.backgroundImage)')
        page.evaluate('window.__qaLogoutObserver.disconnect()')
        assert state['requests'] == count and state['bootstrapRequests'] == bootstraps
    # A page refreshed while already authenticated prepares its image before
    # logout, rather than delaying that work until the login page reappears.
    page.get_by_role('textbox', name='Username', exact=True).fill('qa-admin')
    page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
    page.get_by_role('button', name='Sign in', exact=True).click()
    page.locator('.user-menu').wait_for()
    count = state['requests']
    page.reload(wait_until='networkidle'); page.locator('.user-menu').wait_for()
    page.wait_for_function("async()=>!!(await(await caches.open('castorice-login-background-v7')).match('/api/v2/auth/background?profile=landscape-1920&revision=v53-two-seconds'))")
    assert state['requests'] == count + 1
    count = state['requests']; bootstraps = state['bootstrapRequests']
    page.evaluate("localStorage.setItem('qaBackgroundNow',String(Date.now()+5000))")
    page.locator('.user-menu').click(); page.get_by_role('menuitem', name='Sign out', exact=True).click()
    page.locator('.auth-page').wait_for()
    assert page.locator('.auth-page').evaluate('e=>e.style.backgroundImage.includes("blob:")')
    assert state['requests'] == count and state['bootstrapRequests'] == bootstraps
    lifecycle = {'logoutCycles': 3, 'expiredTtlKeptImage': True, 'firstLogoutPaintHasImage': True, 'authenticatedReloadPreloads': True, 'logoutBackgroundRequests': 0, 'logoutBootstrapRequests': 0}
    page.evaluate("localStorage.removeItem('qaBackgroundNow')")

    # Server fallback is displayed once; it must not schedule a later swap.
    state['stale'] = True; page.reload(wait_until='networkidle'); page.wait_for_function('window.__qaBackgrounds.length===1')
    count = state['requests']; page.wait_for_timeout(2300)
    assert state['requests'] == count and page.evaluate('window.__qaBackgrounds.length') == 1
    state['stale'] = False; state['fail'] = True
    page.reload(wait_until='networkidle')
    if persistent: page.wait_for_function('window.__qaBackgrounds.length===1')
    state['fail'] = False
    if not persistent: page.wait_for_function('window.__qaBackgrounds.length===1')
    count = state['requests']; page.wait_for_timeout(2300); assert state['requests'] == count

    # No stored image: corrupt decoding is retried and then stays stable.
    appearance['revision'] = 'v53-cold-corrupt'; state['corrupt'] = True
    count = state['requests']; page.reload(wait_until='networkidle'); page.wait_for_function('window.__qaBackgrounds.length===1')
    assert state['requests'] == count + 2
    count = state['requests']; page.wait_for_timeout(2300); assert state['requests'] == count

    optical = []; lens_proof = None
    for preset in ('clear', 'default', 'tinted'):
        appearance.update(glassEnabled=True, glass=preset, revision='v53-optics-' + preset)
        for fit in ('cover', 'contain'):
            appearance['fit'] = fit
            for width, height in ((1536, 960), (390, 844), (320, 480)):
                page.set_viewport_size({'width': width, 'height': height}); page.reload(wait_until='networkidle')
                page.locator('feDisplacementMap').wait_for(state='attached')
                expect(page.locator('.auth-card')).to_have_attribute('data-glass', preset)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                if lens_proof is None:
                    page.evaluate("async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}")
                    refracted = hashlib.sha256(page.screenshot()).hexdigest()
                    page.locator('feDisplacementMap').evaluate("e=>e.setAttribute('scale','0')")
                    plain = hashlib.sha256(page.screenshot()).hexdigest()
                    assert refracted != plain, 'lens markup did not change rendered pixels'
                    page.locator('feDisplacementMap').evaluate("e=>e.setAttribute('scale','32')")
                    lens_proof = {'refractedSha256': refracted, 'zeroDisplacementSha256': plain, 'differentRenderedPixels': True}
                if SHOTS and fit == 'cover' and width in (1536, 390):
                    SHOTS.mkdir(parents=True, exist_ok=True); page.screenshot(path=str(SHOTS / f'{engine}-{width}-{preset}.png'), full_page=True)
                optical.append({'preset': preset, 'fit': fit, 'width': width})

    page.set_viewport_size({'width': 1536, 'height': 960})
    page.get_by_role('textbox', name='Username', exact=True).fill('qa-admin')
    page.get_by_label('Password', exact=True).fill('Synthetic-Password-123!')
    page.get_by_role('button', name='Sign in', exact=True).click(); page.locator('.top-app-bar').wait_for()
    page.get_by_role('button', name='Settings', exact=True).click(); page.get_by_text('Sign-in background', exact=True).click()
    source = page.get_by_role('button', name='Sign-in background source', exact=True)
    source.click(); page.get_by_role('option', name='Default Material background', exact=True).click()
    expect(page.get_by_role('switch', name='Liquid Glass', exact=True)).to_have_count(0)
    source.click(); page.get_by_role('option', name='Server image', exact=True).click()
    toggle = page.get_by_role('switch', name='Liquid Glass', exact=True)
    expect(toggle).to_be_visible()
    if toggle.get_attribute('aria-checked') == 'true': toggle.click()
    expect(page.get_by_role('slider')).to_have_count(0)
    toggle.click(); expect(page.get_by_role('slider', name='Glass transparency')).to_be_visible()
    source.click(); page.get_by_role('option', name='Image API', exact=True).click()
    page.get_by_role('button', name='Cache duration', exact=True).click(); expect(page.get_by_role('option', name='No cache', exact=True)).to_be_visible(); page.keyboard.press('Escape')
    metrics = page.locator('.settings-dialog').evaluate("""e=>({
      headings:[...e.querySelectorAll('.theme-section>h3')].map(h=>({icons:h.querySelectorAll('.material-symbols-rounded').length,font:getComputedStyle(h).fontSize})),
      rows:[...e.querySelectorAll('.md-dialog__content > .settings-disclosure > summary,.theme-section > .settings-disclosure > summary,.theme-section > .settings-row,.md-dialog__content > .settings-row')].map(r=>({height:r.getBoundingClientRect().height,pad:getComputedStyle(r).paddingTop,font:getComputedStyle(r.querySelector('strong')).fontSize})),
      setupBorder:getComputedStyle(e.querySelector('.page-customization-switch')).borderTopWidth,
      aboutBorder:getComputedStyle(e.querySelector('.settings-about__content')).borderTopWidth,
      backgroundLabels:[...e.querySelectorAll('.background-settings .field>span,.glass-toggle-row strong')].map(r=>getComputedStyle(r).fontSize)
    })""")
    assert all(h['icons'] == 1 and h['font'] == '14px' for h in metrics['headings']), metrics
    assert all(r['height'] >= 76 and r['pad'] == '16px' and r['font'] == '14px' for r in metrics['rows']), metrics
    assert metrics['setupBorder'] == metrics['aboutBorder'] == '1px', metrics
    assert set(metrics['backgroundLabels']) == {'12px'}, metrics
    if SHOTS: page.screenshot(path=str(SHOTS / f'{engine}-settings.png'), full_page=True)
    assert not errors, errors
    print(json.dumps({'engine': engine, 'passed': True, 'cachePersistence': persistent, 'documentLifecycle': lifecycle, 'opticalCases': optical, 'lensProof': lens_proof, 'settings': metrics, 'backgroundRequests': state['requests'], 'pageErrors': errors}), flush=True)


if __name__ == '__main__':
    with sync_playwright() as p:
        for engine in tuple(sys.argv[1:]) or ('chromium', 'firefox', 'webkit'):
            with tempfile.TemporaryDirectory(prefix='castorice-v53-', ignore_cleanup_errors=True) as profile:
                context = getattr(p, engine).launch_persistent_context(profile, ignore_https_errors=True, viewport={'width': 1536, 'height': 960})
                try: run(engine, context)
                except Exception:
                    if SHOTS:
                        SHOTS.mkdir(parents=True, exist_ok=True)
                        for index, page in enumerate(context.pages):
                            try:
                                page.screenshot(path=str(SHOTS / f'{engine}-failed-{index}.png'), full_page=True)
                                (SHOTS / f'{engine}-failed-{index}.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
                            except Exception: pass
                    raise
                finally: context.close()
