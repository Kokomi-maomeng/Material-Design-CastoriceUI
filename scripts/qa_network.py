"""Network editor and charts against the existing isolated HTTP/SQLite fixture."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from playwright.sync_api import expect
from qa_browser import frames, open_page, settled


def network_product(page, context, dashboard, storage, origin, headers, refresh):
    targets = [{'name': 'First synthetic node', 'address': '192.0.2.1', 'order': 1},
               {'name': 'Second synthetic node', 'address': '192.0.2.2', 'order': 2}]
    assert context.request.put(origin + '/api/v2/settings/network-targets', data={'targets': targets}, headers=headers).ok
    refresh()
    page.reload(wait_until='domcontentloaded'); open_page(page, 'network', 'Network quality')
    page.get_by_role('button', name='Customize', exact=True).click()
    editor = page.get_by_role('dialog', name='Customize network probes', exact=True)
    editor.wait_for()
    orders = editor.get_by_role('button', name='Order', exact=True)
    orders.nth(1).click(); page.get_by_role('option', name='1', exact=True).click()
    assert editor.get_by_role('button', name='Save', exact=True).is_disabled()
    assert editor.get_by_text('Order 1 is duplicated in targets 1, 2', exact=True).count() == 2
    orders.nth(0).click(); page.get_by_role('option', name='2', exact=True).click()
    for invalid in ('65536', '-1', '1.2', '1e3'):
        editor.get_by_label('TCP port', exact=True).nth(0).fill(invalid)
        assert editor.get_by_role('button', name='Save', exact=True).is_disabled()
    editor.get_by_label('TCP port', exact=True).nth(0).fill('')
    editor.get_by_role('button', name='Save', exact=True).click(); editor.wait_for(state='hidden')
    assert storage.get_setting('network_targets', [])[0]['name'] == 'Second synthetic node'
    page.wait_for_function("()=>document.querySelector('.network-target__identity strong')?.textContent==='Second synthetic node'")
    page.get_by_role('button', name='Customize', exact=True).click(); editor.wait_for()
    assert editor.get_by_label('Name', exact=True).nth(0).input_value() == 'Second synthetic node'
    page.keyboard.press('Escape'); editor.wait_for(state='hidden')
    page.set_viewport_size({'width': 1440, 'height': 1000}); settled(page)
    page.get_by_role('button', name='Settings', exact=True).click()
    settings = page.get_by_role('dialog', name='Settings', exact=True)
    settings.wait_for()
    group = settings.locator('.network-settings-group')
    assert group.get_by_text('Customize network probes', exact=True).is_visible()
    assert group.get_by_text('Total traffic quota', exact=True).is_visible()
    assert settings.locator('.general-settings-group').get_by_text('Total traffic quota', exact=True).count() == 0
    group.locator('.settings-row').nth(0).get_by_role('button', name='Set', exact=True).click()
    editor.wait_for(); assert editor.get_by_label('Name', exact=True).nth(0).input_value() == 'Second synthetic node'
    page.keyboard.press('Escape'); editor.wait_for(state='hidden')
    settings.wait_for()
    assert settings.is_visible()
    page.keyboard.press('Escape'); settings.wait_for(state='hidden')
    page.get_by_role('button', name='About metrics', exact=True).hover()
    help_card = page.get_by_role('dialog', name='Network metrics', exact=True)
    help_card.wait_for(); settled(page)
    for name in ('Latency', 'Jitter', 'Packet loss'):
        help_card.get_by_text(name, exact=True).wait_for()
    page.mouse.move(0, 0); help_card.wait_for(state='hidden')
    for language in ('en', 'zh'):
        page.evaluate("language=>localStorage.setItem('castorice-language',language)", language)
        for theme in ('light', 'dark'):
            page.evaluate("theme=>localStorage.setItem('castorice-theme-mode',theme)", theme)
            now = time.time()
            with dashboard.lock:
                dashboard.runtime_cache['network'] = [{**target, 'latency': 1.3, 'loss': 0, 'jitter': 0, 'status': 'healthy', 'measurementStatus': 'measured', 'history': [1.3] * 60,
                    'observedAt': datetime.fromtimestamp(now, timezone.utc).isoformat(), 'complete': True,
                    'probeHistory': [{'capturedAt': now - 59 + i, 'latency': 1.3 if i < 30 else 1.6, 'loss': 0, 'complete': True, 'status': 'healthy'} for i in range(60)],
                    'timeHistory': [{'capturedAt': now - 3600 + i * 60, 'latency': 1.3 + i % 3 / 10, 'loss': 0, 'complete': True, 'hasGaps': True, 'status': 'healthy'} for i in range(60)]}
                    for target in dashboard.config.network_targets]
            refresh()
            storage.reconcile_alerts([])
            storage.acknowledge_all()
            events = [{'id': f'network-qa-{i}', 'title': f'Synthetic network event {i}', 'description': 'RTT 1.3 ms · loss 0%', 'severity': 'warning', 'time': 'now', 'source': 'Synthetic', 'acknowledged': False} for i in range(25)]
            storage.reconcile_alerts(events)
            assert storage.network_alert_preview()['pending'] == 25, storage.network_alert_preview()
            page.reload(wait_until='domcontentloaded'); open_page(page, 'network', 'Network quality' if language == 'en' else '网络质量')
            editor = page.get_by_role('dialog', name='Customize network probes' if language == 'en' else '自定义网络探测', exact=True)
            assert page.locator('.network-alerts-card [role=listitem]').count() == 5
            assert page.locator('.network-alerts-card__rules').count() == 0
            expect(page.locator('.network-alerts-card .md-chip--info')).to_have_text('25 reminders' if language == 'en' else '25 项提醒')
            assert page.locator('.network-alerts-card time').count() >= 5
            for motion in ('reduce', 'no-preference'):
                page.emulate_media(reduced_motion=motion)
                for width in (320, 390, 620, 768, 1440):
                    page.set_viewport_size({'width': width, 'height': 900}); settled(page)
                    geometry = page.evaluate("""()=>({width:innerWidth,doc:document.documentElement.scrollWidth,alerts:[...document.querySelectorAll('.network-alerts-card__list')].map(e=>({scroll:e.scrollHeight,client:e.clientHeight,overflow:getComputedStyle(e).overflowY})),plots:[...document.querySelectorAll('.network-chart__plot')].map(e=>e.getBoundingClientRect().height)})""")
                    assert geometry['doc'] <= width + 1, geometry
                    assert all(item['scroll'] <= item['client'] + 1 and item['overflow'] != 'auto' for item in geometry['alerts']), geometry
                    assert all(abs(height - 220) < 1 for height in geometry['plots']), geometry
                    if width == 320:
                        help_button = page.get_by_role('button', name='About metrics' if language == 'en' else '指标说明', exact=True)
                        help_button.click()
                        popup = page.get_by_role('dialog', name='Network metrics' if language == 'en' else '网络指标说明', exact=True)
                        popup.wait_for(); settled(page)
                        rect = popup.bounding_box(); assert rect['x'] >= 0 and rect['x'] + rect['width'] <= width + 1, rect
                        page.keyboard.press('Escape'); popup.wait_for(state='hidden'); settled(page)
                        expect(help_button).to_have_attribute('aria-expanded', 'false')
                    page.get_by_role('button', name='Customize' if language == 'en' else '自定义', exact=True).click(); editor.wait_for(); settled(page)
                    sizes = editor.locator('input, .md-select-trigger').evaluate_all("elements=>elements.map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth}))")
                    assert all(abs(item['height'] - 42) < 1 for item in sizes), sizes
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    editor.get_by_role('button', name='Order' if language == 'en' else '排序', exact=True).nth(0).click()
                    menu = page.locator('.md-select-menu.is-open'); menu.wait_for()
                    rect = menu.bounding_box(); assert rect['x'] >= 0 and rect['x'] + rect['width'] <= width + 1, rect
                    page.keyboard.press('Escape'); page.keyboard.press('Escape'); editor.wait_for(state='hidden')
            if directory := os.getenv('CASTORICEUI_NETWORK_SCREENSHOTS'):
                Path(directory).mkdir(parents=True, exist_ok=True)
                page.set_viewport_size({'width': 1440, 'height': 1000}); settled(page)
                page.screenshot(path=str(Path(directory) / f'network-{language}-{theme}.png'), full_page=True)
                page.get_by_role('button', name='Customize' if language == 'en' else '自定义', exact=True).click(); editor.wait_for(); settled(page)
                page.screenshot(path=str(Path(directory) / f'editor-{language}-{theme}.png'))
                page.keyboard.press('Escape'); editor.wait_for(state='hidden')
    # Recovery and both acknowledgment entry points use the same real SQLite episodes.
    storage.reconcile_alerts([])
    page.reload(wait_until='domcontentloaded'); open_page(page, 'network', 'Network quality' if language == 'en' else '网络质量')
    card = page.locator('.network-alerts-card')
    assert card.locator('time').count() >= 10
    before = storage.network_alert_preview()['pending']; assert before == 25
    card.get_by_role('button', name='更多记录前往告警中心查看', exact=True).click()
    page.get_by_role('heading', level=1, name='Alerts' if language == 'en' else '告警中心', exact=True).wait_for()
    page.locator('.alert-row').first.get_by_role('button', name='Acknowledge' if language == 'en' else '确认', exact=True).click()
    page.wait_for_function('document.querySelectorAll(".alert-row").length===24')
    open_page(page, 'network', 'Network quality' if language == 'en' else '网络质量')
    expect(card.locator('.md-chip--info')).to_have_text('24 reminders' if language == 'en' else '24 项提醒')
    empty = card.get_by_text('所有问题已确认，更多前往告警中心查看', exact=True)
    def confirm_network():
        with page.expect_response(lambda response: response.url.endswith('/api/v2/network/alerts/ack-all')) as ack:
            card.get_by_role('button', name='全部确认', exact=True).click()
        assert ack.value.ok
        expect(empty).to_be_visible()
    collapse = frames(card.locator('.record-transition'), confirm_network, False)
    assert collapse[0]['height'] > collapse[2]['height'] > collapse[-1]['height'], collapse
    assert card.locator('[role=listitem]').count() == 0
    assert storage.network_alert_preview()['pending'] == 0

    origin_time = page.evaluate('performance.timeOrigin')
    incident = {**events[0], 'id': 'network-live-qa', 'title': 'New network QA alert'}
    def alert_row(panel, episode):
        return panel.locator(f'[data-live-record="{episode}"]')
    first_episode = None
    def show_incident():
        nonlocal first_episode
        first_episode = storage.reconcile_alerts([incident])[incident['id']]['episodeId']
        expect(alert_row(card, first_episode)).to_be_attached(timeout=12000)
    network_frames = frames(card.locator('.record-transition'), show_incident, False)
    assert network_frames[0]['height'] < network_frames[2]['height'] < network_frames[-1]['height'], network_frames
    assert card.get_by_role('button', name='更多记录前往告警中心查看', exact=True).count() == 0
    assert page.evaluate('performance.timeOrigin') == origin_time

    open_page(page, 'alerts', '告警中心')
    alert_panel = page.locator('.alert-panel')
    expect(alert_row(alert_panel, first_episode)).to_be_visible()
    second = {**incident, 'id': 'network-live-second', 'title': 'Second live QA alert'}
    def show_second():
        episode = storage.reconcile_alerts([incident, second])[second['id']]['episodeId']
        expect(alert_row(alert_panel, episode)).to_be_attached(timeout=12000)
    alert_frames = frames(alert_panel.locator('.record-transition'), show_second, False)
    assert alert_frames[0]['height'] < alert_frames[2]['height'] < alert_frames[-1]['height'], alert_frames
    assert page.evaluate('performance.timeOrigin') == origin_time
    return {'layoutCases': 40, 'duplicatesBlocked': True, 'savedOrderPersists': True, 'settingsEntry': True, 'fiveAlertLimit': True, 'uniformControls': True, 'metricsHelp': True, 'recoveryTimes': True, 'sharedAcknowledgement': True, 'liveAlertMotion': True}
