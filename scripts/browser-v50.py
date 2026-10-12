"""Synthetic v5.0 interaction/overflow/background lifecycle browser acceptance."""
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit
import zlib

from playwright.sync_api import expect, sync_playwright
from browser_fixture import empty_dashboard

BASE = os.environ.get("CASTORICEUI_BROWSER_URL", "https://127.0.0.1:5173").rstrip("/")
ENGINES = tuple(sys.argv[1:]) or ("chromium", "firefox", "webkit")


def image(seed):
    width, height = 240, 160
    raw = b"".join(b"\0" + bytes(channel for x in range(width) for channel in ((x + seed * 20) % 256, (y * 2 + seed * 13) % 256, (x + y + 110) % 256)) for y in range(height))
    def chunk(kind, data): return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def run(engine, context):
    context.add_init_script("localStorage.setItem('castorice-language','en');localStorage.setItem('castorice-theme-mode','dark')")
    page = context.new_page(); errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    dashboard = empty_dashboard(context, page, BASE)
    dashboard.update(mode="live", generatedAt="2026-01-01T00:00:00Z")
    state = {"authenticated": False, "failed": False, "corrupt": False, "images": 0, "profiles": [], "saved": None}
    appearance = {"type": "url", "url": "/api/v2/auth/background", "fit": "cover", "cacheSeconds": 0, "glass": "default", "glassEnabled": True, "revision": "synthetic-v50"}
    critical = [{"id": "critical", "episodeId": f"critical-{i}", "severity": "critical", "title": f"Critical episode {i}", "description": "Synthetic", "source": "QA", "time": "now", "startedAt": "2026-01-01T00:00:00Z", "resolvedAt": "2026-01-01T01:00:00Z", "status": "resolved", "acknowledged": False} for i in range(2)]
    warnings = [{**critical[0], "id": "warning", "episodeId": f"warning-{i}", "severity": "warning", "title": f"Warning {i}"} for i in range(35)]

    def summary():
        count = sum(not row["acknowledged"] for row in critical)
        return {"pending": count + 35, "critical": count, "warning": 35, "info": 0, "active": 0, "recoveredPending": count + 35}

    def route_api(route):
        parsed = urlsplit(route.request.url); path = parsed.path.removeprefix("/api/v2/")
        if path == "auth/background":
            state["images"] += 1; state["profiles"].append(parse_qs(parsed.query)["profile"][0])
            assert "cookie" not in route.request.headers, "background sent a visitor cookie"
            if state.get("hold"):
                state["held"] = route
                return
            if state["failed"]: route.fulfill(status=503, json={"error": "background_temporarily_unavailable"}, headers={"Retry-After": "2"}); return
            route.fulfill(body=b"invalid" if state["corrupt"] else image(state["images"]), content_type="image/png", headers={"Cache-Control": "no-store"}); return
        if path == "bootstrap": data = {"setupRequired": False, "bootstrapAvailable": False, "appearance": appearance}
        elif path == "auth/session" and not state["authenticated"]:
            route.fulfill(status=401, json={"error": "authentication_required"}); return
        elif path == "auth/logout": state["authenticated"] = False; data = {"ok": True}
        elif path.startswith("auth/"):
            state["authenticated"] = True; data = {"username": "QA", "csrfToken": "synthetic", "expiresAt": int(time.time()) + 3600, "setupComplete": True}
        elif path == "dashboard":
            dashboard.update(alerts=warnings[:30], alertSummary=summary()); data = dashboard
        elif path.startswith("alerts/") and path.endswith("/ack"):
            for row in critical:
                if row["episodeId"] == path.split("/")[1]: row["acknowledged"] = True
            data = {"ok": True}
        elif path == "alerts":
            rows = [row for row in critical + warnings if not row["acknowledged"]]
            data = {"items": rows[:30], "total": len(rows), "page": 1, "pageSize": 30, "totalPages": 2, "summary": summary()}
        elif path == "settings/background-options":
            data = {"files": [], "directory": "/var/lib/castoriceui/login-backgrounds", "selected": appearance, "configured": {**appearance, "value": "https://images.example.com/random"}}
        elif path == "settings/login-background":
            state["saved"] = route.request.post_data_json
            appearance.update({key: value for key, value in state["saved"].items() if key != "value"}, revision="synthetic-v50-saved")
            data = appearance
        elif path in {"audits", "settings/ui"}: data = {"items": [], "total": 0, "page": 1, "pageSize": 30, "totalPages": 1} if path == "audits" else dashboard["uiSettings"]
        else: data = {"ok": True}
        route.fulfill(json=data)

    context.route("**/api/v2/**", route_api)
    def document_policy(route):
        response = route.fetch()
        route.fulfill(response=response, headers={**response.headers, "Content-Security-Policy": "img-src 'self' data: blob:"})
    context.route(BASE + "/", document_policy)
    # A synthetic existing authentication cookie must still be omitted for images.
    context.add_cookies([{"name": "castorice_session", "value": "synthetic-browser-session", "url": BASE}])
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage.includes('blob:')")
    assert state["images"] == 1
    page.get_by_role("button", name="Language", exact=True).click()
    menu = page.get_by_role("listbox", name="Language")
    expect(menu.get_by_role("option")).to_have_count(3)
    assert menu.evaluate("e=>e.scrollHeight<=e.clientHeight+1 && getComputedStyle(e).scrollbarGutter==='auto'")
    page.keyboard.press("Escape")
    assert page.evaluate("document.documentElement.scrollHeight<=innerHeight+1"), "empty login viewport scrolls"
    for field in page.locator(".auth-input").all():
        assert field.evaluate("e=>{let i=e.querySelector('input'),s=getComputedStyle(i);return s.borderTopWidth==='0px' && s.borderRadius==='0px' && i.getBoundingClientRect().right<=e.getBoundingClientRect().right}")
    page.get_by_role("textbox", name="Username", exact=True).fill("qa-admin")
    page.get_by_label("Password", exact=True).fill("Synthetic-Password-123!")
    if engine == "chromium":
        cdp = context.new_cdp_session(page)
        cdp.send("DOM.enable"); cdp.send("CSS.enable")
        root = cdp.send("DOM.getDocument")["root"]["nodeId"]
        node = cdp.send("DOM.querySelector", {"nodeId": root, "selector": ".auth-input input"})["nodeId"]
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": ["autofill"]})
        autofill = page.locator(".auth-input input").first.evaluate("e=>({active:e.matches(':autofill'),radius:getComputedStyle(e).borderRadius,fill:getComputedStyle(e).webkitTextFillColor,expected:getComputedStyle(e.parentElement).color})")
        assert autofill["active"] and autofill["radius"] == "0px" and autofill["fill"] == autofill["expected"], autofill
        if os.environ.get("CASTORICEUI_QA_SHOTS"):
            page.screenshot(path=str(Path(os.environ["CASTORICEUI_QA_SHOTS"]) / "chromium-auth-autofill.png"))
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": []})

    # Reload failures and decode failures preserve a decoded image from Cache Storage.
    page.wait_for_function("async()=> (await (await caches.open('castorice-login-background-v5')).keys()).length>0", timeout=5000)
    state["failed"] = True
    page.reload(wait_until="networkidle")
    page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage.includes('blob:')")
    state["failed"] = False
    page.wait_for_timeout(2300)
    assert state["images"] >= 3
    state["corrupt"] = True
    page.reload(wait_until="networkidle")
    page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage.includes('blob:')")
    state["corrupt"] = False
    page.wait_for_timeout(2300)
    count = state["images"]; page.wait_for_timeout(2300)
    assert state["images"] == count, "background polls without an entry/resize event"

    # Keep the visible image while a different, uncached viewport is pending
    # or unavailable; publish that viewport's image only after it decodes.
    previous = page.locator(".auth-page").get_attribute("style")
    state["hold"] = True
    with page.expect_request(lambda request: "profile=landscape-2560" in request.url):
        page.set_viewport_size({"width": 2560, "height": 1440})
    page.wait_for_timeout(200)
    assert page.locator(".auth-page").get_attribute("style") == previous, "pending viewport cleared the decoded background"
    with page.expect_response(lambda response: "profile=landscape-2560" in response.url):
        state.pop("held").fulfill(status=503, json={"error": "background_temporarily_unavailable"}, headers={"Retry-After": "2"})
    state["hold"] = False
    page.wait_for_timeout(200)
    assert page.locator(".auth-page").get_attribute("style") == previous, "failed viewport cleared the decoded background"
    page.wait_for_function("previous=>document.querySelector('.auth-page').getAttribute('style')!==previous", arg=previous)
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.wait_for_timeout(500)

    cases = 0
    shots = Path(os.environ["CASTORICEUI_QA_SHOTS"]) if os.environ.get("CASTORICEUI_QA_SHOTS") else None
    if shots: shots.mkdir(parents=True, exist_ok=True)
    for width, height in ((1920, 1080), (2560, 1440), (390, 844), (320, 360)):
        page.set_viewport_size({"width": width, "height": height})
        for theme in ("light", "dark"):
            for preset in ("clear", "default", "tinted", "solid"):
                page.evaluate("([theme,preset])=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;document.querySelector('.auth-card').dataset.glass=preset}", [theme, preset])
                page.evaluate("document.fonts.ready")
                page.evaluate("async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})))}")
                assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), (engine, width, theme, preset)
                if preset == "solid": assert page.locator(".auth-card").evaluate("e=>getComputedStyle(e).backdropFilter==='none'")
                if shots and width in (1920, 390): page.screenshot(path=str(shots / f"{engine}-{width}-{theme}-{preset}.png"), full_page=True)
                cases += 1
        page.get_by_role("button", name="Language", exact=True).click()
        expect(page.locator(".md-select-menu.is-open")).to_be_visible()
        page.locator(".md-select-menu.is-open").evaluate("async e=>{await Promise.all(e.getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}")
        rect = page.locator(".md-select-menu").bounding_box()
        assert rect["x"] >= 10 and rect["x"] + rect["width"] <= width - 10, (engine, width, height, rect)
        assert rect["y"] >= 10 and rect["y"] + rect["height"] <= height - 10
        page.keyboard.press("Escape")
    page.set_viewport_size({"width": 1440, "height": 1000})
    if engine == "chromium":
        cdp.send("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-reduced-transparency", "value": "reduce"}]})
        assert page.locator(".auth-card").evaluate("e=>getComputedStyle(e).backdropFilter==='none'")
        cdp.send("Emulation.setEmulatedMedia", {"features": []})
        cdp.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 1.5})
        page.get_by_role("button", name="Language", exact=True).focus()
        page.keyboard.press("ArrowDown")
        page.wait_for_function("(()=>{let e=document.querySelector('.md-select-menu'),v=visualViewport;if(!e)return false;let r=e.getBoundingClientRect();return r.left>=v.offsetLeft+10&&r.right<=v.offsetLeft+v.width-10&&r.top>=v.offsetTop+10&&r.bottom<=v.offsetTop+v.height-10})()")
        page.keyboard.press("Escape")
        cdp.send("Emulation.setPageScaleFactor", {"pageScaleFactor": 1})
    page.get_by_role("textbox", name="Username", exact=True).fill("qa-admin")
    page.get_by_label("Password", exact=True).fill("Synthetic-Password-123!")
    page.get_by_role("button", name="Sign in", exact=True).click()
    page.locator(".notification-button.has-critical").wait_for()
    assert page.locator(".notification-button .material-symbols-rounded").evaluate("e=>getComputedStyle(e).animationName==='critical-notification'")
    page.emulate_media(reduced_motion="reduce")
    assert page.locator(".notification-button .material-symbols-rounded").evaluate("e=>getComputedStyle(e).animationName==='none'")
    page.emulate_media(reduced_motion="no-preference")
    page.locator(".notification-button").click()
    page.locator(".alert-row").filter(has_text="Critical episode 0").get_by_role("button", name="Acknowledge", exact=True).click()
    page.locator(".alert-row").filter(has_text="Critical episode 0").wait_for(state="detached")
    expect(page.locator(".notification-button")).to_have_class("notification-button has-critical")
    page.locator(".alert-row").filter(has_text="Critical episode 1").get_by_role("button", name="Acknowledge", exact=True).click()
    page.wait_for_function("!document.querySelector('.notification-button')?.classList.contains('has-critical')")
    assert not any(row["acknowledged"] for row in warnings)
    # Authenticated reload does not transiently mount login and fetch an image.
    count = state["images"]
    page.reload(wait_until="networkidle")
    page.locator(".top-app-bar").wait_for()
    assert state["images"] == count
    page.get_by_role("button", name="Settings", exact=True).click()
    page.get_by_text("Sign-in background", exact=True).click()
    for width, height in ((1440, 1000), (390, 844), (320, 480)):
        page.set_viewport_size({"width": width, "height": height})
        fit = page.get_by_role("button", name="Image fit", exact=True)
        duration = page.get_by_role("button", name="Background duration", exact=True)
        fit.scroll_into_view_if_needed(); duration.scroll_into_view_if_needed()
        a, b = fit.bounding_box(), duration.bounding_box()
        assert abs(a["width"] - b["width"]) < 1 and abs(a["height"] - b["height"]) < 1, (engine, a, b)
        duration.click()
        options = page.get_by_role("listbox", name="Background duration")
        assert options.evaluate("e=>getComputedStyle(e).scrollbarGutter==='auto'")
        if height < 600: assert options.evaluate("e=>e.scrollHeight>e.clientHeight"), "long menu lost scrolling"
        expect(options.locator("[aria-selected='true']")).to_be_focused()
        page.keyboard.press("End")
        expect(page.get_by_role("option", name="10min", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        page.locator(".md-select-menu").wait_for(state="detached")
    page.get_by_text("Liquid Glass", exact=True).click()
    slider = page.get_by_role("slider", name="Glass transparency")
    expect(slider).to_have_value("1")
    page.get_by_role("checkbox", name="Use card appearance").check()
    expect(slider).to_be_disabled()
    page.get_by_role("checkbox", name="Use card appearance").uncheck()
    slider.fill("2")
    page.get_by_role("button", name="Save sign-in background", exact=True).click()
    page.wait_for_function("document.querySelector('.toast')")
    assert state["saved"]["cacheSeconds"] == 600 and state["saved"]["glass"] == "tinted" and "position" not in state["saved"]
    page.get_by_role("button", name="Close", exact=True).click()
    page.locator(".md-dialog-layer").wait_for(state="detached")
    logout_images = state["images"]
    page.locator(".user-menu").click()
    page.get_by_role("menuitem", name="Sign out", exact=True).click()
    page.locator(".auth-card").wait_for()
    page.wait_for_function("document.querySelector('.auth-page')?.style.backgroundImage.includes('blob:')")
    assert state["images"] == logout_images + 1, "logout fetched once using an outdated appearance"
    assert not errors, errors
    print(json.dumps({"engine": engine, "glassThemeViewportCases": cases, "backgroundRequests": state["images"], "distinctProfiles": len(set(state["profiles"])), "pageErrors": len(errors), "synthetic": True}))


if __name__ == "__main__":
    with sync_playwright() as p:
        for engine in ENGINES:
            # WebKit's ephemeral contexts discard Cache API entries on reload.
            # A fresh temporary profile tests normal browser persistence without
            # sharing any real user profile or weakening reload assertions.
            with tempfile.TemporaryDirectory(prefix="castorice-v50-", ignore_cleanup_errors=True) as profile:
                context = getattr(p, engine).launch_persistent_context(profile, ignore_https_errors=True, viewport={"width": 1440, "height": 1000}, reduced_motion="no-preference", ignore_default_args=["--hide-scrollbars"] if engine == "chromium" else [])
                try: run(engine, context)
                finally: context.close()
