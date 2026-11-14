"""Account subscription cards, shared history boundaries and focus indicators."""
import base64
import json
import os
import sys
import time
from urllib.parse import parse_qs, urlsplit
from pathlib import Path

from playwright.sync_api import Error, expect, sync_playwright
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
    dashboard['traffic']['unassignedAccountBytes'] = 12_500_000_000
    dashboard['uiSettings']['visiblePanels'] = ['alerts', 'accounts', 'services', 'network', 'traffic', 'audit']
    state = {'count': 1, 'urlReads': 0, 'writes': [], 'heldUrl': None, 'delayUrl': False}
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
        elif path in ('alerts', 'audits/search'):
            if path == "audits/search":
                query = {key: [str(value)] for key, value in route.request.post_data_json.items()}
            total = state['count']; page_number = int(query.get('page', ['1'])[0]); size = int(query.get('pageSize', ['50'])[0])
            rows = []
            for index in range((page_number - 1) * size, min(total, page_number * size)):
                if path == 'alerts':
                    rows.append({'id': f'qa-{index}', 'episodeId': f'qa-{index}', 'severity': 'warning', 'title': f'QA alert {index}', 'description': 'Synthetic', 'source': 'QA', 'time': 'now', 'startedAt': '2026-11-01T00:00:00Z', 'acknowledged': False, 'status': 'active'})
                else:
                    rows.append({'id': str(index), 'action': '登录成功', 'category': '认证', 'actor': 'QA', 'ip': '192.0.2.1', 'time': '2026-11-01T00:00:00Z', 'result': '成功', 'detail': 'Synthetic'})
            data = {'items': rows, 'total': total, 'page': page_number, 'pageSize': size, 'totalPages': max(1, (total + size - 1) // size), 'summary': {'pending': total, 'warning': total, 'critical': 0, 'info': 0}}
        elif path.endswith('/url'):
            state['urlReads'] += 1
            if state['delayUrl']:
                state['heldUrl'] = route
                return
            data = {'url': url}
        elif path == 'settings/background-options':
            data = {'files': [], 'directory': '/var/lib/castoriceui/backgrounds', 'selected': {'type': 'default', 'url': '', 'fit': 'cover'}, 'configured': {'type': 'default', 'value': ''}}
        elif path == 'settings/ui':
            state['writes'].append(route.request.post_data_json); dashboard['uiSettings'].update(route.request.post_data_json); data = dashboard['uiSettings']
        else:
            data = {}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))

    context.route('**/api/v2/**', api)
    # Keep one dashboard document per language. Changing the hash exercises real
    # route mounts without resetting WebKit's TLS session and request interception.
    page.goto(BASE + '/#/overview', wait_until='domcontentloaded')
    overview = page.locator('.traffic-hero')
    overview.wait_for()

    def leave_history():
        page.evaluate("location.hash='/overview'")
        overview.wait_for()

    cases = []; animations = []; focus_count = 0
    titles = {'accounts': ('账号管理', 'Account management'), 'alerts': ('告警中心', 'Alerts'), 'audit': ('审计中心', 'Audit center')}
    for section in titles:
        for index, total in enumerate((0, 1, 29, 30, 31, 121)):
            width, height = ((1536, 960), (901, 420), (390, 844), (320, 700))[index % 4]
            leave_history()
            page.set_viewport_size({'width': width, 'height': height})
            state['count'] = total; dashboard['accounts'] = [account(i) for i in range(total)]
            page.evaluate("name=>location.hash='/'+name", section)
            page.get_by_role('heading', name=titles[section][language == 'en'], exact=True).wait_for()
            footer = page.locator('.audit-controls'); expect(footer).to_contain_text(f'总计 {total} 条' if language == 'zh' else f'{total} total records', timeout=20000)
            expect(footer.locator('button')).to_have_count(1 if total >= 30 else 0)
            if total >= 30:
                expect(footer).to_contain_text('默认显示最近 30 条' if language == 'zh' else 'Showing the latest 30 by default')
                if total == 121:
                    settled(page)
                    try:
                        sampled = frames(page.locator('.record-transition'), lambda: footer.locator('button').click(), False)
                    except Error as error:
                        raise AssertionError((engine, language, section, 'Record expansion animation was not measurable')) from error
                    animations.append({'section': section, 'frames': len(sampled)})
                    assert len({round(row['height'], 1) for row in sampled}) >= 3, (section, sampled)
                    footer.locator('button').click(); settled(page)
            if not page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'):
                print(json.dumps({'overflow': page.evaluate("()=>[...document.querySelectorAll('#main-content *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0}).slice(0,16).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,80)}))")}), flush=True)
                page.screenshot(path='outputs/v61-overflow.png')
                raise AssertionError((section, total, width, 'document overflow'))
            page.keyboard.press('Tab')
            focus_count += page.evaluate("""()=>{let count=0;for(const e of document.querySelectorAll('button:not([disabled]),input,textarea,summary,[tabindex="0"],a[href]')){if(e.closest('[inert],[aria-hidden="true"]')||!e.getClientRects().length)continue;e.focus({preventScroll:true});const field=e.matches('input')&&e.closest('.search-field,.auth-input,.md-select-search,.quota-input-stable');const s=getComputedStyle(field||e);if(e.matches(':focus-visible')){if(parseFloat(s.outlineWidth)<2||parseFloat(s.outlineOffset)>-parseFloat(s.outlineWidth))throw Error('Clipped/absent outline: '+(field||e).className);count++}}return count}""")
            cases.append({'section': section, 'total': total, 'width': width})

    translated = lambda zh, en: zh if language == 'zh' else en
    dashboard['accounts'] = [
        {**account(0), 'name': 'Bravo', 'email': 'bravo@example.test', 'usedBytes': 50, 'protocols': ['AnyTLS']},
        {**account(1), 'name': 'Alpha', 'email': 'alpha@example.test', 'usedBytes': 120, 'protocols': ['Hysteria2'], 'expiresAt': '2027-02-01'},
        {**account(2), 'name': 'Charlie', 'email': 'charlie@example.test', 'usedBytes': 90, 'protocols': ['VMess'], 'expiresAt': '2027-01-01'},
        {**account(3), 'name': 'Delta', 'email': 'delta@example.test', 'usedBytes': 200, 'protocols': ['Hysteria2'], 'configuredStatus': 'disabled'},
    ]
    leave_history()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.evaluate("location.hash='/accounts'")
    names = page.locator('.account-subscription-trigger strong')
    search_button = page.get_by_role('button', name=translated('搜索与排序账号', 'Search and sort accounts'), exact=True)
    expect(names).to_have_text(['Bravo', 'Alpha', 'Charlie', 'Delta'], timeout=20000)
    expect(page.get_by_role('textbox', name=translated('搜索账号', 'Search accounts'), exact=True)).to_have_count(0)
    search_button.click()
    page.get_by_role('button', name='A–Z', exact=True).click()
    expect(names).to_have_text(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    page.get_by_role('button', name='Z–A', exact=True).click()
    expect(names).to_have_text(['Delta', 'Charlie', 'Bravo', 'Alpha'])
    page.get_by_role('textbox', name=translated('搜索账号', 'Search accounts'), exact=True).fill('example.test')
    page.keyboard.press('Escape')
    expect(search_button).to_be_focused()

    traffic_sort = page.get_by_role('button', name=translated('按累计流量排序', 'Sort by cumulative traffic'), exact=True)
    for ordered in (['Delta', 'Alpha', 'Charlie', 'Bravo'], ['Bravo', 'Charlie', 'Alpha', 'Delta'], ['Bravo', 'Alpha', 'Charlie', 'Delta']):
        traffic_sort.click()
        expect(names).to_have_text(ordered)
    expiry_sort = page.get_by_role('button', name=translated('按到期时间排序', 'Sort by expiry date'), exact=True)
    for ordered in (['Charlie', 'Alpha', 'Bravo', 'Delta'], ['Alpha', 'Charlie', 'Bravo', 'Delta']):
        expiry_sort.click()
        expect(names).to_have_text(ordered)
        expect(page.locator('.accounts-table th[aria-sort]')).to_have_count(1)

    status_label = translated('筛选账号状态', 'Filter account status')
    page.get_by_role('button', name=status_label, exact=True).click()
    page.get_by_role('dialog', name=status_label).get_by_role('button', name=translated('账号启用', 'Account enabled'), exact=True).click()
    protocol_label = translated('筛选协议', 'Filter protocols')
    page.get_by_role('button', name=protocol_label, exact=True).click()
    protocol_filter = page.get_by_role('dialog', name=protocol_label)
    protocol_filter.get_by_role('button', name='Hysteria2', exact=True).click()
    expect(names).to_have_text(['Alpha'])
    protocol_filter.get_by_role('button', name='VMess', exact=True).click()
    expect(names).to_have_text(['Alpha', 'Charlie'])
    page.keyboard.press('Escape')
    expiry_sort.click()
    expect(page.locator('.accounts-table th[aria-sort]')).to_have_count(0)
    expect(names).to_have_text(['Alpha', 'Charlie'])
    expect(page.locator('.accounts-table tbody tr').first).to_have_class('account-unattributed')
    assert page.locator('.account-cell .avatar').evaluate_all("avatars=>avatars.every(e=>getComputedStyle(e).width==='34px'&&getComputedStyle(e).backgroundColor===getComputedStyle(avatars[0]).backgroundColor)")

    page.evaluate("""()=>{window.qaAccountMotion=[];document.addEventListener('animationstart',e=>{
      if(e.target.matches('.account-results > tr,.account-column__action > span,.account-column-popover'))window.qaAccountMotion.push(e.animationName)
    })}""")
    def headers():
        return page.locator('.accounts-table thead').evaluate("""e=>{
          const card=e.closest('.accounts-panel').getBoundingClientRect();
          return [e,...e.querySelectorAll('th,.account-column__action')].map(node=>{
            const r=node.getBoundingClientRect();
            if(r.left<card.left-.5||r.right>card.right+.5||r.top<card.top-.5||node.clientWidth&&node.scrollWidth>node.clientWidth+2)throw Error('Account header exceeds panel');
            return [r.left,r.top+scrollY,r.width,r.height]
          })
        }""")
    stable_headers = 0
    for width in (320, 390, 681, 760, 901, 1536):
        page.set_viewport_size({'width': width, 'height': 720})
        page.get_by_role('button', name=protocol_label, exact=True).click()
        for protocol in ('Hysteria2', 'VMess'):
            protocol_filter.get_by_role('button', name=protocol, exact=True).click()
        expect(names).to_have_text(['Bravo', 'Alpha', 'Charlie'])
        settled(page)
        before = headers()
        protocol_filter.get_by_role('button', name='TUIC', exact=True).click()
        expect(page.get_by_text(translated('没有符合条件的账号', 'No matching accounts'), exact=True)).to_be_visible()
        settled(page)
        after = headers()
        assert all(abs(a - b) < 1 for prior, current in zip(before, after) for a, b in zip(prior, current)), (engine, width, before, after)
        protocol_filter.get_by_role('button', name='TUIC', exact=True).click()
        for protocol in ('Hysteria2', 'VMess'):
            protocol_filter.get_by_role('button', name=protocol, exact=True).click()
        page.keyboard.press('Escape')
        stable_headers += 1
    traffic_sort.click()
    settled(page)
    motion_names = page.evaluate('window.qaAccountMotion')
    assert 'record-enter' in motion_names and 'control-check-in' in motion_names and any(name.startswith('md-floating-in-') for name in motion_names), motion_names
    page.emulate_media(reduced_motion='reduce')
    traffic_sort.click()
    assert page.locator('.account-results > tr').first.evaluate("e=>getComputedStyle(e).animationName") == 'none'
    assert traffic_sort.locator('span').evaluate("e=>getComputedStyle(e).animationName") == 'none'
    page.emulate_media(reduced_motion='no-preference')

    # The removed route cannot expose a standalone page. Account details own it.
    leave_history()
    dashboard['accounts'] = [account(0)]; dashboard['subscriptions'] = [{'id': 'qa-sub', 'account': 'qa-0', 'protocols': ['AnyTLS'], 'enabled': True}]
    dashboard['traffic']['totalBytes'] = 12_500_000_000
    page.set_viewport_size({'width': 390, 'height': 844})
    page.evaluate("location.hash='/accounts'")
    expect(names).to_have_text(['QA 0'], timeout=20000)
    assert state['urlReads'] == 0
    search_button.click()
    search = page.get_by_role('textbox', name='搜索账号' if language == 'zh' else 'Search accounts', exact=True)
    search.click(); search.fill('　ＱＡ ０　')
    assert search.evaluate("""e => {
        const ring=getComputedStyle(e.closest('.search-field'));
        return getComputedStyle(e).outlineStyle==='none' && parseFloat(ring.outlineWidth)>=2 && parseFloat(ring.borderRadius)>=20;
    }""")
    page.keyboard.press('Escape')
    pinned = page.locator('.accounts-table tbody tr').first
    expect(pinned).to_contain_text('未归属' if language == 'zh' else 'Unattributed')
    expect(pinned).to_contain_text('12.5 GB')
    expect(pinned.locator('button')).to_have_count(0)
    trigger = page.get_by_role('button', name='查看 QA 0 的订阅' if language == 'zh' else 'View QA 0 subscriptions', exact=True)
    state['delayUrl'] = True
    with page.expect_request('**/subscriptions/*/url'):
        trigger.click()
    expect(page.get_by_text('正在读取订阅' if language == 'zh' else 'Loading subscription', exact=True)).to_be_visible()
    copy = page.get_by_role('button', name='复制地址' if language == 'zh' else 'Copy URL', exact=True)
    expect(copy).to_be_disabled()
    slot = page.locator('.subscription-qr-slot')
    settled(page)
    before = slot.bounding_box()
    state['heldUrl'].fulfill(json={'url': url})
    state['delayUrl'] = False
    expect(page.locator('.qr-surface svg')).to_be_visible(); settled(page)
    after = slot.bounding_box()
    assert abs(after['height'] - before['height']) < 2 and abs(after['width'] - before['width']) < 2
    assert state['urlReads'] == 1
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
    page.evaluate("location.hash='/subscriptions'")
    expect(page).to_have_url(BASE + '/#/accounts')
    expect(page.locator('.account-subscriptions')).to_have_count(0)

    page.set_viewport_size({'width': 1536, 'height': 960})
    page.evaluate("location.hash='/traffic'")
    expect(page.get_by_text(translated('连接与用量', 'Connections and usage'), exact=True)).to_be_visible()
    usage = page.locator('.traffic-analysis')
    toggle = usage.get_by_role('button', name=translated('用量明细', 'Usage details'), exact=True)
    expect(toggle).to_have_attribute('aria-expanded', 'true')
    page.mouse.move(0, 0); settled(page)
    surface = usage.evaluate('e=>getComputedStyle(e).backgroundColor')
    toggle.hover(); settled(page)
    hover = usage.evaluate('e=>getComputedStyle(e).backgroundColor')
    assert hover != surface and toggle.evaluate('e=>getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
    page.mouse.down(); settled(page)
    assert usage.evaluate('e=>getComputedStyle(e).backgroundColor') != hover
    page.mouse.up()
    expect(toggle).to_have_attribute('aria-expanded', 'false')

    page.evaluate("location.hash='/accounts'")
    page.get_by_role('heading', name=translated('账号管理', 'Account management'), exact=True).wait_for()
    settled(page)
    page.get_by_role('button', name='设置' if language == 'zh' else 'Settings', exact=True).click()
    group = page.locator('.security-settings-group'); expect(group).to_contain_text('在线超时时长' if language == 'zh' else 'Inactivity timeout')
    expect(group).to_contain_text('更换密码' if language == 'zh' else 'Change password')
    group.locator('summary').filter(has_text='日志审计时长' if language == 'zh' else 'Audit log retention').click(); settled(page)
    group.get_by_role('button', name='日志审计时长' if language == 'zh' else 'Audit log retention', exact=True).click()
    expect(page.get_by_role('option')).to_have_count(7); settled(page)
    if os.environ.get('CASTORICEUI_QA_SHOTS'):page.screenshot(path=str(folder / f'{engine}-{language}-security.png'))
    page.get_by_role('option', name='30d', exact=True).click()
    page.wait_for_function("()=>document.querySelector('.security-settings-group').textContent.includes('30')")
    assert state['writes'] == [{'auditRetentionDays': 30}]
    assert not errors, errors
    context.close()
    return {'language': language, 'cases': cases, 'animations': animations, 'focusIndicators': focus_count, 'clientLinks': True, 'securitySettings': True, 'stableQrLoading': True, 'searchRing': True, 'pinnedUsage': True, 'accountColumns': True, 'stableEmptyHeaders': stable_headers, 'accountMotion': True, 'usageCard': True}


with sync_playwright() as playwright:
    for engine in tuple(sys.argv[1:]) or ('chromium', 'firefox', 'webkit'):
        browser = getattr(playwright, engine).launch(headless=True)
        results = [run(engine, browser, language) for language in ('en', 'zh')]
        browser.close()
        print(json.dumps({'accountAuditCenter': True, 'passed': True, 'engine': engine, 'languages': results}), flush=True)
