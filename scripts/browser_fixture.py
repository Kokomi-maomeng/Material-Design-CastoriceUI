"""Prepare synthetic data before the application makes any API requests."""


def empty_dashboard(context, page, base_url):
    # A real same-origin document establishes the dev TLS connection without
    # starting the application or issuing a bootstrap request.
    page.goto(base_url.rstrip("/") + "/scripts/browser-fixture.html", wait_until="networkidle", timeout=15000)
    return page.evaluate("async()=>structuredClone((await import('/lib/empty-dashboard.ts')).emptyDashboard)")
