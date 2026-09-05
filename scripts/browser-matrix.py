from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("CASTORICEUI_BROWSER_URL", "https://127.0.0.1:5173").rstrip("/")
ENGINES = tuple(sys.argv[1:]) or ("chromium", "firefox", "webkit")
VIEWPORTS = ((2560, 1440), (1440, 1000), (768, 1024), (390, 844), (320, 700))
PAGES = ("overview", "services", "traffic", "network")


def synthetic_dashboard(page) -> dict[str, object]:
    """Load the typed empty payload and add only synthetic, publishable QA data."""
    page.goto(BASE_URL, wait_until="domcontentloaded")
    dashboard = page.evaluate(
        "async () => structuredClone((await import('/lib/empty-dashboard.ts')).emptyDashboard)"
    )
    now = datetime(2026, 1, 15, 4, 0, tzinfo=timezone.utc)
    points = [
        {
            "label": f"{hour:02d}:00",
            "capturedAt": (now - timedelta(hours=23 - hour)).isoformat().replace("+00:00", "Z"),
            "download": float(62 if hour == 20 else (hour % 5) + 1),
            "upload": float(18 if hour == 20 else (hour % 3) + 0.5),
        }
        for hour in range(24)
    ]
    dashboard.update(mode="live", generatedAt=now.isoformat().replace("+00:00", "Z"))
    dashboard["overview"].update(
        nodeName="QA node",
        cpuPercent=9,
        cpuCores=2,
        memoryPercent=46,
        memoryUsedBytes=445_900_000,
        memoryTotalBytes=967_600_000,
        diskPercent=10,
        diskUsedBytes=1_900_000_000,
        diskTotalBytes=19_600_000_000,
        load=[0.25, 0.07, 0.02],
        uptimeSeconds=654321,
        trafficUsedBytes=165_100_000_000,
        trafficLimitBytes=1_000_000_000_000,
        trafficCycleStart="2026-01-01T03:30:00Z",
        trafficBaselineBytes=50_000_000_000,
        trafficCountMode="sum",
        trafficQuotaUnit="GB",
        trafficQuota={
            "bytes": 1_000_000_000_000,
            "autoReset": True,
            "periodUnit": "month",
            "periodCount": 1,
            "resetAnchor": "2026-01-01",
            "resetTime": "03:30",
            "timezone": "UTC",
            "cycleStart": "2026-01-01T03:30:00Z",
            "nextReset": "2026-02-01T03:30:00Z",
        },
        downloadBps=5_100,
        uploadBps=235,
        interface="eth0",
        kernel="6.12.0-qa",
        databaseBytes=2_800_000,
        databaseWritable=True,
    )
    protocols = (
        ("hysteria2", "Hysteria2", "bolt"),
        ("singbox", "sing-box", "encrypted"),
        ("anytls", "AnyTLS", "encrypted"),
        ("vless", "VLESS", "route"),
        ("socks5", "SOCKS5", "lan"),
        ("shadowsocks", "Shadowsocks", "shield"),
        ("vmess", "VMess", "vpn_key"),
        ("trojan", "Trojan", "security"),
        ("tuic", "TUIC", "speed"),
    )
    dashboard["services"] = [
        {
            "id": service_id,
            "kind": "core" if service_id == "singbox" else "protocol",
            "name": name,
            "nameZh": name,
            "nameEn": name,
            "detail": "systemd active",
            "detailZh": "systemd 正常",
            "detailEn": "systemd active",
            "status": "running",
            "version": "1.0.0",
            "uptimeSeconds": 654321,
            "icon": icon,
        }
        for service_id, name, icon in protocols
    ]
    dashboard["services"].extend(
        [
            {"id": "nginx", "kind": "core", "name": "Nginx", "detail": "active", "status": "running", "version": "1.26.3", "uptimeSeconds": 654321, "icon": "language"},
            {"id": "kernel", "kind": "core", "name": "Linux kernel", "detail": "2 CPU", "status": "running", "version": "6.12.0-qa", "uptimeSeconds": 654321, "icon": "memory"},
            {"id": "certificate", "kind": "core", "name": "TLS certificate", "detail": "65 days remaining", "status": "running", "version": "TLS", "icon": "verified_user"},
        ]
    )
    dashboard["traffic"].update(
        totalBytes=165_100_000_000,
        protocolTotalBytes=3_000_000_000,
        accountTotalBytes=165_100_000_000,
        ranges={key: points for key in ("1h", "6h", "24h", "3day", "7day")},
        hourly=points,
        daily=points,
        monthly=[
            {"startDate": f"2025-{month:02d}-01", "endDate": f"2025-{month:02d}-28", "bytes": month * 10_000_000_000}
            for month in range(7, 13)
        ],
        protocol=[{"name": "Hysteria2", "value": 2_000_000_000}, {"name": "AnyTLS", "value": 1_000_000_000}],
        account=[{"name": "primary", "value": 165_100_000_000}],
    )
    dashboard["networkTargets"] = [
        {"id": f"qa-{index}", "name": f"QA target {index}", "provider": "Synthetic", "address": f"192.0.2.{index}", "ipVersion": 4, "latency": 1 + index / 10, "jitter": 0.1, "loss": 0, "status": "healthy", "history": [1, 1.2, 1.1, 1.3, 1.0]}
        for index in range(1, 6)
    ]
    dashboard["uiSettings"].update(
        showSetup=True,
        visiblePanels=["alerts", "accounts", "subscriptions", "services", "network", "connections", "traffic", "audit"],
    )
    return dashboard


def open_page(page, section: str) -> None:
    page.evaluate("section => { location.hash = '/' + section; }", section)
    page.locator("#main-content .page-loading").wait_for(state="detached")
    page.locator("#main-content h1").wait_for()


with sync_playwright() as playwright:
    bootstrap_browser = getattr(playwright, ENGINES[0]).launch(headless=True)
    bootstrap_context = bootstrap_browser.new_context(ignore_https_errors=True)
    dashboard = synthetic_dashboard(bootstrap_context.new_page())
    bootstrap_browser.close()

    errors: list[str] = []
    results: list[dict[str, object]] = []
    quota_writes: list[dict[str, object]] = []

    def route_api(route) -> None:
        request_path = route.request.url.split("/api/v2/", 1)[1].split("?", 1)[0]
        if request_path == "bootstrap":
            data = {"setupRequired": False, "bootstrapAvailable": False, "appearance": {"type": "default", "url": "", "fit": "cover", "position": "center"}}
        elif request_path == "auth/session":
            data = {"username": "QA operator", "csrfToken": "synthetic-csrf", "expiresAt": int(time.time()) + 3600, "setupComplete": True}
        elif request_path == "dashboard":
            data = dashboard
        elif request_path == "settings/traffic-limit":
            payload = route.request.post_data_json
            quota_writes.append(payload)
            data = {"ok": True, **payload}
        elif request_path == "settings/background-options":
            data = {"files": [], "directory": "/var/lib/castoriceui/backgrounds", "selected": {"type": "default", "url": "", "fit": "cover", "position": "center"}, "configured": {"type": "default", "value": ""}}
        elif request_path == "audits":
            data = {"items": [], "total": 0, "page": 1, "pageSize": 30, "totalPages": 1}
        else:
            data = {}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

    for engine in ENGINES:
        browser = getattr(playwright, engine).launch(headless=True)
        context = browser.new_context(ignore_https_errors=True, viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        context.route("**/api/v2/**", route_api)
        context.add_init_script("localStorage.setItem('castorice-language','en');localStorage.setItem('castorice-theme-mode','dark');")
        page = context.new_page()
        page.on("pageerror", lambda error, name=engine: errors.append(f"{name}: pageerror: {error}"))
        page.on("console", lambda message, name=engine: errors.append(f"{name}: console: {message.text}") if message.type == "error" else None)
        page.goto(BASE_URL, wait_until="networkidle")
        page.locator(".traffic-hero").wait_for()

        page.get_by_role("button", name="Edit traffic quota", exact=True).click()
        page.locator(".quota-dialog").wait_for()
        assert page.get_by_role("spinbutton", name="Total traffic (GB)").input_value() == "1000"
        assert page.get_by_role("button", name="Reset hour").locator("span").first.inner_text().strip() == "03"
        assert page.get_by_role("button", name="Reset minute").locator("span").first.inner_text().strip() == "30"
        page.locator(".quota-dialog").get_by_role("button", name="Save", exact=True).click()
        page.locator(".quota-dialog").wait_for(state="detached")

        page.get_by_role("button", name="Settings", exact=True).click()
        page.locator(".settings-dialog").wait_for()
        assert "Material-Design-CastoriceUI" in page.locator(".settings-about-section").inner_text()
        page.get_by_role("button", name="Close", exact=True).click()

        for language in ("en", "zh"):
            page.evaluate("language => localStorage.setItem('castorice-language', language)", language)
            page.reload(wait_until="networkidle")
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                for section in PAGES:
                    open_page(page, section)
                    page.evaluate("document.fonts.ready")
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 2"), (engine, language, width, section, "document overflow")
                    if section == "traffic":
                        assert page.locator(".chart--traffic").evaluate("element => element.scrollWidth <= element.clientWidth + 2"), (engine, language, width, section, "chart clipping")
                    if section == "network":
                        assert page.locator(".sparkline").first.evaluate("element => getComputedStyle(element).height") == "200px"
                results.append({"engine": engine, "language": language, "width": width, "pages": len(PAGES)})
        browser.close()

assert not errors, errors
assert len(quota_writes) == len(ENGINES), quota_writes
report = {"layoutGroups": len(results), "layoutCases": len(results) * len(PAGES), "javascriptErrors": errors, "quotaWrites": len(quota_writes)}
if report_path := os.environ.get("CASTORICEUI_BROWSER_REPORT"):
    Path(report_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report))
