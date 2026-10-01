"""Browser regressions for stable scrollbars, local times and durable alerts.

All API records are synthetic. No production login or acknowledgement occurs.
"""
import json
import os
import sys
import time
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import TimeoutError as BrowserTimeout, sync_playwright

BASE_URL = os.environ.get("CASTORICEUI_BROWSER_URL", "https://127.0.0.1:5173").rstrip("/")
ENGINES = tuple(sys.argv[1:]) or ("chromium", "firefox", "webkit")
PAGES = ("overview", "traffic", "connections", "accounts", "network", "services", "subscriptions", "alerts", "audit", "setup")
TIME = "2026-01-01T00:00:00+00:00"


def run(engine, timezone, browser):
    context = browser.new_context(ignore_https_errors=True, timezone_id=timezone, viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    context.add_init_script("localStorage.setItem('castorice-language','en')")
    page = context.new_page()
    page.add_init_script("window.qaScrollEvents=[];for(const event of ['scroll','pointerdown','click'])addEventListener(event,e=>{window.qaScrollEvents.push({event,y:scrollY,lock:document.documentElement.classList.contains('has-dialog'),target:e.target?.className});window.qaScrollEvents=window.qaScrollEvents.slice(-20)},true)")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    for attempt in range(3):
        try:
            page.goto(BASE_URL, wait_until="domcontentloaded", timeout=15_000)
            break
        except BrowserTimeout:
            if attempt == 2:
                raise
    dashboard = page.evaluate("async()=>structuredClone((await import('/lib/empty-dashboard.ts')).emptyDashboard)")
    dashboard.update(mode="live", generatedAt=TIME)
    dashboard["uiSettings"]["visiblePanels"] = list(PAGES)
    history = [{"id": "same-condition", "episodeId": f"episode-{i}", "title": f"Synthetic alert {i}", "description": "QA condition", "source": "Synthetic QA", "severity": "warning", "acknowledged": False, "status": "resolved", "time": "now", "startedAt": TIME, "resolvedAt": TIME, "acknowledgedAt": None} for i in range(135)]
    audits = [{"id": f"audit-{i}", "time": TIME, "action": "登录成功", "category": "认证", "actor": "QA", "ip": "192.0.2.1", "result": "成功", "detail": "Synthetic audit"} for i in range(135)]

    def summary():
        count = sum(not item["acknowledged"] for item in history)
        return {"pending": count, "critical": 0, "warning": count, "info": 0}

    def route_api(route):
        parsed = urlsplit(route.request.url)
        path = parsed.path.removeprefix("/api/v2/")
        query = parse_qs(parsed.query)
        if path == "dashboard":
            dashboard.update(alerts=history[:30], alertSummary=summary())
            data = dashboard
        elif path == "bootstrap":
            data = {"setupRequired": False, "bootstrapAvailable": False, "appearance": {"type": "default", "url": "", "fit": "cover", "position": "center"}}
        elif path.startswith("auth/"):
            data = {"username": "QA", "csrfToken": "synthetic-csrf", "expiresAt": int(time.time())+3600, "setupComplete": True}
        elif path in ("alerts", "audits"):
            rows = audits if path == "audits" else [item for item in history if query.get("filter", ["all"])[0] == "all" or not item["acknowledged"]]
            size = int(query.get("pageSize", ["30"])[0])
            pages = max(1, (len(rows)+size-1)//size)
            current = min(int(query.get("page", ["1"])[0]), pages)
            data = {"items": rows[(current-1)*size:current*size], "total": len(rows), "page": current, "totalPages": pages, "pageSize": size, "summary": summary()}
        elif path == "alerts/ack-all" or path.startswith("alerts/") and path.endswith("/ack"):
            for item in history:
                if path == "alerts/ack-all" or item["episodeId"] == path.split("/")[1]:
                    item.update(acknowledged=True, acknowledgedAt=TIME)
            data = {"ok": True}
        elif path == "settings/background-options":
            data = {"files": [], "directory": "/var/lib/castoriceui/backgrounds", "selected": {"type": "default", "url": "", "fit": "cover", "position": "center"}, "configured": {"type": "default", "value": ""}}
        else:
            data = {"ok": True}
        route.fulfill(json=data)

    context.route("**/api/v2/**", route_api)
    page.reload(wait_until="networkidle")
    page.locator(".traffic-hero").wait_for()

    def open_page(section):
        page.evaluate("section=>location.hash='/'+section", section)
        page.locator("#main-content .page-loading").wait_for(state="detached")
        page.locator("#main-content h1").wait_for()

    def geometry():
        return page.evaluate("()=>{let r=document.querySelector('.app-main').getBoundingClientRect();return {x:r.x,width:r.width,scroll:scrollY,overflow:getComputedStyle(document.documentElement).overflowY}}")

    def stable(before):
        after = geometry()
        assert abs(before["x"]-after["x"]) < 0.5 and abs(before["width"]-after["width"]) < 0.5, (engine, timezone, before, after)
        assert before["scroll"] == after["scroll"], ("background scroll changed", before, after, page.evaluate("window.qaScrollEvents"))
        assert after["overflow"] == "scroll"

    def close_dialog():
        page.get_by_role("button", name="Close", exact=True).click()
        page.locator(".md-dialog-layer").wait_for(state="detached")
        assert page.locator("#root").evaluate("element=>!element.inert"), "background remained inert after closing"

    cases = 0
    for width, height in ((1440, 1000), (390, 844), (320, 700)):
        page.set_viewport_size({"width": width, "height": height})
        for section in PAGES:
            open_page(section)
            page.wait_for_function("document.documentElement.scrollWidth <= innerWidth+2")
            if width > 900:
                page.get_by_role("button", name="Hide sidebar", exact=True).click()
                assert not page.locator(".drawer-scrim").is_visible()
                page.get_by_role("button", name="Show sidebar", exact=True).click()
            else:
                page.get_by_role("button", name="Open navigation", exact=True).click()
            page.evaluate("scrollTo({top:100,behavior:'instant'})")
            before = geometry()
            page.get_by_role("button", name="Settings", exact=True).click()
            page.locator(".settings-dialog").wait_for()
            stable(before)
            assert page.locator(".md-dialog__content").evaluate("e=>getComputedStyle(e).overflowY==='scroll' && getComputedStyle(e).scrollbarWidth!=='none'")
            page.mouse.move(2, 200)
            page.mouse.wheel(0, 400)
            page.wait_for_timeout(80)
            stable(before)
            if section == "overview":
                page.locator(".settings-row--action").get_by_role("button", name="Set", exact=True).click()
                page.wait_for_function("document.querySelectorAll('.md-dialog').length===2")
                stable(before)
                page.locator(".md-dialog").last.get_by_role("button", name="Close", exact=True).click()
                page.wait_for_function("document.querySelectorAll('.md-dialog').length===1")
                assert page.locator(".settings-dialog").evaluate("element=>!element.inert")
                stable(before)
                page.locator("summary").filter(has_text="Inactivity timeout").click()
                page.get_by_role("button", name="Inactivity timeout", exact=True).click()
                page.locator(".md-select-menu").wait_for()
                stable(before)
                page.keyboard.press("Escape")
                page.locator(".md-select-menu").wait_for(state="detached")
                assert page.locator(".settings-dialog").is_visible()
            close_dialog()
            stable(before)
            if width <= 900:
                scrim = page.get_by_role("button", name="Close navigation", exact=True)
                box = scrim.bounding_box()
                assert box
                scrim.click(position={"x": box["width"]-20, "y": box["height"]-20})
            cases += 1

        open_page("setup")
        padding = page.locator(".setup-prerequisites .card-header").evaluate("e=>{let s=getComputedStyle(e);return [parseFloat(s.paddingTop),parseFloat(s.paddingBottom)]}")
        assert padding[0] == padding[1] and padding[1] >= 16
        for index in range(page.locator(".setup-panel button").count()):
            button = page.locator(".setup-panel button").nth(index)
            button.scroll_into_view_if_needed()
            page.wait_for_timeout(120)
            before = geometry()
            button.click()
            page.locator(".md-dialog").wait_for()
            stable(before)
            page.get_by_role("button", name="Start", exact=True).click()
            stable(before)
            close_dialog()
            stable(before)
            cases += 1

    page.set_viewport_size({"width": 1440, "height": 1000})
    open_page("audit")
    page.locator(".mono-time").first.wait_for()
    expected = page.evaluate("value=>new Intl.DateTimeFormat('en',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value))", TIME)
    assert page.locator(".mono-time").first.inner_text() == expected
    assert timezone in page.locator("#main-content").inner_text()
    page.get_by_role("button", name="Show all logs").click()
    page.locator(".audit-table tbody tr").nth(49).wait_for()
    audit_controls = page.locator(".md-pagination").inner_text()
    open_page("alerts")
    page.locator(".alert-row").nth(49).wait_for()
    assert page.locator(".notification-badge").inner_text() == "99+"
    page.get_by_role("button", name="Acknowledge", exact=True).first.click()
    page.get_by_text("Synthetic alert 0", exact=True).wait_for(state="detached")
    assert not history[1]["acknowledged"], "acknowledging one episode confirmed another"
    page.get_by_role("button", name="All records", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.alert-row').length===30")
    page.get_by_role("button", name="Show all records").click()
    page.locator(".alert-row").nth(49).wait_for()
    assert page.locator(".md-pagination").inner_text() == audit_controls
    page.get_by_role("textbox", name="Enter page number").fill("3")
    page.get_by_role("button", name="Go", exact=True).click()
    page.get_by_text("Synthetic alert 100", exact=True).wait_for()
    page.get_by_role("button", name="Collapse to latest 30").click()
    page.wait_for_function("document.querySelectorAll('.alert-row').length===30")
    page.get_by_role("button", name="Acknowledge all", exact=True).click()
    page.get_by_role("button", name="Pending 0", exact=True).wait_for()
    assert len(history) == 135 and all(item["acknowledged"] for item in history)
    assert not page.locator(".notification-badge").count()
    assert not errors, errors
    context.close()
    return {"engine": engine, "timeZone": timezone, "dialogCases": cases, "pendingPersistenceAndPagination": True, "localTime": expected, "javascriptErrors": errors}


with sync_playwright() as playwright:
    for engine in ENGINES:
        options = {"ignore_default_args": ["--hide-scrollbars"]} if engine == "chromium" else {}
        browser = getattr(playwright, engine).launch(**options)
        for timezone in ("Asia/Shanghai", "America/New_York", "Europe/Berlin"):
            print(json.dumps(run(engine, timezone, browser)), flush=True)
        browser.close()
