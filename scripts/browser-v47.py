"""Real-browser monitoring interactions using synthetic records only."""
import json
import os
import sys
import time
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import expect, sync_playwright

base = os.environ.get("CASTORICEUI_BROWSER_URL", "https://127.0.0.1:5173")
with sync_playwright() as playwright:
    for engine in tuple(sys.argv[1:]) or ("chromium", "firefox", "webkit"):
        browser = getattr(playwright, engine).launch()
        context = browser.new_context(ignore_https_errors=True, reduced_motion="reduce")
        context.add_init_script("localStorage.setItem('castorice-language','en')")
        page = context.new_page()
        errors, mutations = [], []
        page.on("pageerror", lambda error: errors.append(type(error).__name__))
        context.route("**/api/v2/bootstrap", lambda route: route.fulfill(json={"setupRequired": True, "bootstrapAvailable": False}))
        page.goto(base, wait_until="domcontentloaded")
        dashboard = page.evaluate("async()=>structuredClone((await import('/lib/empty-dashboard.ts')).emptyDashboard)")
        dashboard.update(mode="live", generatedAt="2026-01-01T00:00:00Z")
        dashboard["uiSettings"]["visiblePanels"] = ["network", "alerts", "services"]
        dashboard["integrations"] = [{"id": key, "enabled": True, "configured": True, "ready": True, "status": "ready", "summary": "Synthetic integration"} for key in ("network", "alerts")]
        target = {"id": "qa", "name": "Synthetic target", "address": "192.0.2.1", "provider": "QA", "ipVersion": 4, "order": 1, "latency": 10, "jitter": 0, "loss": 12.5, "status": "degraded", "history": [10, 12], "complete": True, "effectivePolicy": {"latencyMs": 150, "lossPercent": 5, "windowSeconds": 120, "minimumPackets": 24}, "timeHistory": [{"capturedAt": 1700000000, "latency": 10, "loss": 0, "complete": True}, {"capturedAt": 1700000020, "latency": None, "loss": None, "complete": False}, {"capturedAt": 1700000040, "latency": 20, "loss": 12.5, "complete": True}]}
        dashboard["networkTargets"] = [target]
        active = {"id": "qa", "episodeId": "qa-active", "title": "Synthetic active", "description": "QA", "source": "QA", "severity": "warning", "acknowledged": False, "status": "active", "startedAt": "2026-01-01T00:00:00Z", "time": "now"}
        recovered = {**active, "episodeId": "qa-resolved", "title": "Synthetic recovered", "status": "resolved", "resolvedAt": "2026-01-01T00:01:00Z"}
        summary = {"active": 1, "recoveredPending": 1, "pending": 2, "critical": 0, "warning": 2, "info": 0}

        def route_api(route):
            url = urlsplit(route.request.url)
            path = url.path.removeprefix("/api/v2/")
            query = parse_qs(url.query)
            if path == "dashboard":
                data = {**dashboard, "alerts": [active, recovered], "alertSummary": summary}
            elif path == "bootstrap":
                data = {"setupRequired": False, "bootstrapAvailable": False, "appearance": {"type": "default", "url": "", "fit": "cover", "position": "center"}}
            elif path.startswith("auth/"):
                data = {"username": "QA", "csrfToken": "synthetic-csrf", "expiresAt": int(time.time()) + 3600, "setupComplete": True}
            elif path == "alerts":
                selected = query.get("filter", ["pending"])[0]
                items = [active] if selected == "active" else [recovered] if selected == "recovered" else [active, recovered]
                data = {"items": items, "total": len(items), "page": 1, "pageSize": 50, "totalPages": 1, "summary": summary}
            elif path == "settings/network-targets":
                mutations.append(route.request.post_data_json)
                data = {"ok": True}
            else:
                if route.request.method != "GET":
                    raise AssertionError("Unexpected monitoring mutation")
                data = {"ok": True}
            route.fulfill(json=data)

        context.route("**/api/v2/**", route_api)
        page.reload(wait_until="networkidle")
        cases = 0
        for width, height in ((1440, 1000), (390, 844), (320, 700)):
            page.set_viewport_size({"width": width, "height": height})
            page.evaluate("location.hash='/alerts'")
            page.get_by_role("heading", name="Alerts", exact=True).wait_for(timeout=10000)
            page.get_by_role("button", name="Active 1", exact=True).click()
            expect(page.get_by_text("Synthetic active", exact=True)).to_be_visible()
            expect(page.get_by_text("Synthetic recovered", exact=True)).to_have_count(0)
            page.get_by_role("button", name="Recovered pending 1", exact=True).click()
            expect(page.get_by_text("Synthetic recovered", exact=True)).to_be_visible()
            page.evaluate("location.hash='/network'")
            expect(page.get_by_text("Poor", exact=True)).to_be_visible()
            expect(page.get_by_text("Replies this round", exact=True)).to_be_visible()
            expect(page.locator('svg[aria-label="Synthetic target time trend"] polyline')).to_have_count(2)
            page.get_by_role("button", name="Customize", exact=True).click()
            page.get_by_text("Thresholds and service checks", exact=True).click()
            page.get_by_label("Loss threshold (%)", exact=True).fill("20")
            page.get_by_label("TCP service port", exact=True).fill("443")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth+2"), (engine, width, "page overflow")
            assert page.locator(".md-dialog").evaluate("element=>element.scrollWidth<=element.clientWidth+2"), (engine, width, "dialog overflow")
            page.get_by_role("button", name="Save", exact=True).click()
            page.get_by_role("heading", name="Customize network probes", exact=True).wait_for(state="detached")
            assert mutations[-1]["targets"][0]["lossPercent"] == 20
            assert mutations[-1]["targets"][0]["tcpPort"] == 443
            cases += 1
        assert not errors, errors
        print(json.dumps({"engine": engine, "monitoringViewportCases": cases, "pageErrors": len(errors), "automaticAcknowledgements": 0}))
        browser.close()
