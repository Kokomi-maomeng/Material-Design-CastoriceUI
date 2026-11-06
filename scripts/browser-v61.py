"""Account subscription cards, shared history boundaries and focus indicators."""
import base64
import json
import os
import sys
import time
from urllib.parse import parse_qs, urlsplit
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from browser_fixture import empty_dashboard
from qa_browser import settled, frames

BASE = os.environ.get('CASTORICEUI_BROWSER_URL', 'https://127.0.0.1:5173').rstrip('/')


def account(index):
    return {'id': f'qa-{index}', 'name': f'QA {index}', 'email': '', 'status': 'registered', 'configuredStatus': 'active', 'expiryStatus': 'notConfigured', 'coreEvidence': 'unknown', 'protocols': ['AnyTLS'], 'usedBytes': 0, 'usageSource': 'unmapped', 'quotaBytes': 0, 'expiresAt': '', 'onlineDevices': 0}


def run(engine, browser, language):
    context = browser.new_context(ignore_https_errors=True, viewport={'width': 1536, 'height': 960})
    context.add_init_script("localStorage.setItem('castorice-language', '" + language + "'); window.qaCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>window.qaCopied.push(value)}})")
    page = context.new_page()
    dashboard = empty_dashboard(context, page, BASE)
    dashboard.update(mode='live', generatedAt='2026-11-01T00:00:00Z')
    dashboard['uiSettings']['visiblePanels'] = ['alerts', 'accounts', 'services', 'network', 'connections', 'traffic', 'audit']
    state = {'count': 1, 'urlReads': 0, 'writes': []}
    url = 'https://publisher.example.com/qa.yaml?token=synthetic%2Bvalue'
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = urlsplit(route.request.url).path.removeprefix('/api/v2/')
        query = parse_qs(urlsplit(route.request.url).query)
        if path == 'bootstrap':
            data = {'setupRequired': False, 'bootstrapAvailable': False, 'appearance': {'type': 'default', 'url': '', 'fit': 'cover'}}
        elif path == 'auth/session':
            data = {'username': 'QA operator', 'csrfToken': 'synthetic-csrf', 'expiresAt': int(time.time()) + 3600, 'setupComplete': True}
        elif path == 'dashboard':
            data = dashboard
        elif path in ('alerts', 'audits'):
            total = state['count']; page_number = int(query.get('page', ['1'])[0]); size = int(query.get('pageSize', ['50'])[0])
            rows = []
            for index in range((page_number - 1) * size, min(total, page_number * size)):
                if path == 'alerts':
                    rows.append({'id': f'qa-{index}', 'episodeId': f'qa-{index}', 'severity': 'warning', 'title': f'QA alert {index}', 'description': 'Synthetic', 'source': 'QA', 'time': 'now', 'startedAt': '2026-11-01T00:00:00Z', 'acknowledged': False, 'status': 'active'})
                else:
                    rows.append({'id': str(index), 'action': '登录成功', 'category': '认证', 'actor': 'QA', 'ip': '192.0.2.1', 'time': '2026-11-01T00:00:00Z', 'result': '成功', 'detail': 'Synthetic'})
            data = {'items': rows, 'total': total, 'page': page_number, 'pageSize': size, 'totalPages': max(1, (total + size - 1) // size), 'summary': {'pending': total, 'warning': total, 'critical': 0, 'info': 0}}
        elif path.endswith('/url'):
            state['urlReads'] += 1; data = {'url': url}
        elif path == 'settings/background-options':
            data = {'files': [], 'directory': '/var/lib/castoriceui/backgrounds', 'selected': {'type': 'default', 'url': '', 'fit': 'cover'}, 'configured': {'type': 'default', 'value': ''}}
        elif path == 'settings/ui':
            state['writes'].append(route.request.post_data_json); dashboard['uiSettings'].update(route.request.post_data_json); data = dashboard['uiSettings']
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    context.route('**/api/v2/**', api)
    cases = []; animations = []; focus_count = 0
    titles = {'accounts': ('账号状态', 'Account status'), 'alerts': ('告警中心', 'Alerts'), 'audit': ('审计中心', 'Audit center')}
    for section in titles:
        for index, total in enumerate((0, 1, 29, 30, 31, 121)):
            width, height = ((1536, 960), (901, 420), (390, 844), (320, 700))[index % 4]
            page.set_viewport_size({'width': width, 'height': height})
            state['count'] = total; dashboard['accounts'] = [account(i) for i in range(total)]
            page.goto(BASE + '/?qa_case=' + section + str(total) + '#/' + section, wait_until='networkidle')
            page.get_by_role('heading', name=titles[section][language == 'en'], exact=True).wait_for()
            footer = page.locator('.audit-controls'); expect(footer).to_contain_text(f'总计 {total} 条' if language == 'zh' else f'{total} total records')
            expect(footer.locator('button')).to_have_count(1 if total >= 30 else 0)
            if total >= 30:
                expect(footer).to_contain_text('默认显示最近 30 条' if language == 'zh' else 'Showing the latest 30 by default')
                if total == 121:
                    sampled = frames(page.locator('.record-transition'), lambda: footer.locator('button').click(), False)
                    animations.append({'section': section, 'frames': len(sampled)})
                    assert len({round(row['height'], 1) for row in sampled}) >= 3, (section, sampled)
                    footer.locator('button').click(); settled(page)
            if not page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'):
                print(json.dumps({'overflow': page.evaluate("()=>[...document.querySelectorAll('#main-content *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0}).slice(0,16).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,80)}))")}), flush=True)
                page.screenshot(path='outputs/v61-overflow.png')
                raise AssertionError((section, total, width, 'document overflow'))
            page.keyboard.press('Tab')
            focus_count += page.evaluate("""()=>{let count=0;for(const e of document.querySelectorAll('button:not([disabled]),input,textarea,summary,[tabindex="0"],a[href]')){if(e.closest('[inert],[aria-hidden="true"]')||!e.getClientRects().length)continue;e.focus({preventScroll:true});const s=getComputedStyle(e);if(e.matches(':focus-visible')){if(parseFloat(s.outlineWidth)<2||parseFloat(s.outlineOffset)>-parseFloat(s.outlineWidth))throw Error('Clipped/absent outline: '+e.className);count++}}return count}""")
            cases.append({'section': section, 'total': total, 'width': width})

    # The removed route cannot expose a standalone page. Account details own it.
    dashboard['accounts'] = [account(0)]; dashboard['subscriptions'] = [{'id': 'qa-sub', 'account': 'qa-0', 'protocols': ['AnyTLS'], 'enabled': True}]
    page.set_viewport_size({'width': 390, 'height': 844}); page.goto(BASE + '/#/accounts', wait_until='networkidle')
    assert state['urlReads'] == 0
    page.get_by_role('button', name='查看 QA 0 的订阅' if language == 'zh' else 'View QA 0 subscriptions', exact=True).click()
    expect(page.locator('.qr-surface svg')).to_be_visible()
    if os.environ.get('CASTORICEUI_QA_SHOTS'):
        folder = Path(os.environ['CASTORICEUI_QA_SHOTS']); folder.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(folder / f'{engine}-{language}-account-card.png'))
    for name in (('复制地址', 'Copy URL'), ('复制 Clash 链接', 'Copy Clash link'), ('复制 Shadowrocket 链接', 'Copy Shadowrocket link')):
        page.get_by_role('button', name=name[language == 'en'], exact=True).click()
    copied = page.evaluate('window.qaCopied')
    assert copied[0] == url and parse_qs(urlsplit(copied[1]).query)['url'] == [url]
    assert base64.b64decode(copied[2].split('sub://')[1].split('?')[0]).decode() == url
    page.get_by_role('button', name='完成' if language == 'zh' else 'Done', exact=True).click()
    expect(page.locator('.qr-surface')).to_have_count(0)
    page.goto(BASE + '/#/subscriptions', wait_until='networkidle')
    assert page.locator('.account-subscriptions').count() == 0

    page.goto(BASE + '/#/accounts', wait_until='networkidle')
    page.set_viewport_size({'width': 1536, 'height': 960}); settled(page)
    page.get_by_role('button', name='设置' if language == 'zh' else 'Settings', exact=True).click()
    group = page.locator('.security-settings-group'); expect(group).to_contain_text('在线超时时长' if language == 'zh' else 'Inactivity timeout')
    expect(group).to_contain_text('更换密码' if language == 'zh' else 'Change password')
    group.locator('summary').filter(has_text='日志审计时长' if language == 'zh' else 'Audit log retention').click(); settled(page)
    group.get_by_role('button', name='日志审计时长' if language == 'zh' else 'Audit log retention', exact=True).click()
    expect(page.get_by_role('option')).to_have_count(7)
    if os.environ.get('CASTORICEUI_QA_SHOTS'):page.screenshot(path=str(folder / f'{engine}-{language}-security.png'))
    page.get_by_role('option', name='30天' if language == 'zh' else '30 days', exact=True).click()
    page.wait_for_function("()=>document.querySelector('.security-settings-group').textContent.includes('30')")
    assert state['writes'] == [{'auditRetentionDays': 30}]
    assert not errors, errors
    context.close()
    return {'language': language, 'cases': cases, 'animations': animations, 'focusIndicators': focus_count, 'clientLinks': True, 'securitySettings': True}


with sync_playwright() as playwright:
    for engine in tuple(sys.argv[1:]) or ('chromium', 'firefox', 'webkit'):
        browser = getattr(playwright, engine).launch(headless=True)
        results = [run(engine, browser, language) for language in ('en', 'zh')]
        browser.close()
        print(json.dumps({'accountAuditCenter': True, 'passed': True, 'engine': engine, 'languages': results}), flush=True)
