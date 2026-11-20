"""Fresh operator journey over HTTPS with a real Linux backend and SQLite."""
from __future__ import annotations
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

from qa_browser import settled

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://127.0.0.1:5173"


def exercise(browser, generate_token, base=BASE):
    context = browser.new_context(ignore_https_errors=True, locale="zh-CN", viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base, wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="创建第一个管理员")).to_be_visible()
    expect(page.get_by_role("button", name="创建并继续")).to_be_disabled()
    expect(page.get_by_role("alert")).to_contain_text("服务器缺少一次性引导码")
    token = generate_token()
    page.reload(wait_until="domcontentloaded")
    create = page.get_by_role("button", name="创建并继续")
    expect(create).to_be_enabled()
    create.press("Enter")
    expect(page.get_by_role("alert")).to_contain_text("请输入一次性引导码")
    expect(page.get_by_label("一次性引导码", exact=True)).to_be_focused()
    page.get_by_role("button", name="语言", exact=True).click()
    page.get_by_role("option", name="English", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("Enter the one-time bootstrap token")
    expect(page.locator("html")).to_have_attribute("lang", "en")

    page.get_by_label("One-time bootstrap token", exact=True).fill(token)
    page.get_by_label("Username", exact=True).fill("qa-admin")
    page.get_by_label("Password", exact=True).fill("Synthetic-Password-123!")
    page.get_by_role("button", name="Create and continue").press("Enter")
    heading = page.get_by_role("heading", name="Confirm live data integrations")
    expect(heading).to_be_focused()
    expect(page.get_by_role("button", name="Finish and open dashboard")).to_be_disabled()
    assert context.request.get(f"{base}/api/v2/bootstrap").json()["bootstrapAvailable"] is False
    quota = page.get_by_label("Total traffic quota (GB)")
    page.get_by_label("Node display name").fill("QA real backend")
    quota.fill("1000001")
    quota.press("Enter")
    expect(page.get_by_role("alert")).to_contain_text("Enter a quota from 1 to 1,000,000 GB")
    expect(quota).to_be_focused()
    assert context.request.get(f"{base}/api/v2/auth/session").json()["setupBasics"] is None
    quota.fill("2048.5")
    quota.press("Enter")
    expect(page.get_by_role("button", name="Saved", exact=True)).to_be_visible()
    expect(page.locator('[aria-current="step"]')).to_contain_text("Optional sources")
    page.reload(wait_until="domcontentloaded")
    expect(heading).to_be_focused()
    expect(quota).to_have_value("2048.5")
    expect(page.get_by_role("button", name="Finish and open dashboard")).to_be_enabled()

    page.get_by_role("button", name="Alert thresholds", exact=True).click()
    wizard = page.get_by_role("dialog")
    expect(wizard.get_by_text("Overview", exact=True)).to_be_visible()
    wizard.get_by_role("button", name="Start", exact=True).press("Enter")
    expect(wizard.get_by_role("spinbutton", name="Traffic threshold (%)")).to_be_focused()
    wizard.get_by_role("button", name="Save and validate").press("Enter")
    expect(wizard.locator(".wizard-success")).to_be_focused()
    wizard.get_by_role("button", name="Done", exact=True).press("Enter")
    expect(wizard).to_have_count(0)

    page.get_by_role("button", name="Sign out", exact=True).click()
    expect(page.get_by_role("heading", name="Welcome back")).to_be_visible()
    page.get_by_label("Username", exact=True).fill("qa-admin")
    page.get_by_label("Password", exact=True).fill("Synthetic-Password-123!")
    page.get_by_role("button", name="Sign in", exact=True).press("Enter")
    expect(page.get_by_role("button", name="Saved", exact=True)).to_be_visible()
    page.get_by_role("button", name="Finish and open dashboard").press("Enter")
    overview = page.get_by_role("heading", name="QA real backend", exact=True)
    expect(overview).to_be_visible()
    actual = context.request.get(f"{base}/api/v2/dashboard").json()
    assert actual["overview"]["trafficLimitBytes"] == 2_048_500_000_000
    assert actual["overview"]["memoryTotalBytes"] > 0 and actual["overview"]["uptimeSeconds"] > 0
    assert actual["mode"] == "live"
    assert context.request.get(f"{base}/api/v2/auth/session").json()["setupComplete"] is True
    page.reload(wait_until="domcontentloaded")
    expect(overview).to_be_visible()
    page.get_by_role("button", name="Open navigation", exact=True).press("Enter")
    page.get_by_role("navigation", name="Primary navigation").get_by_role("button", name="Audit center", exact=True).press("Enter")
    expect(page.get_by_text("Saved first-run settings", exact=True)).to_be_visible()
    expect(page.get_by_text("Completed initialization", exact=True)).to_be_visible()
    settled(page)
    context.close()

    fallback = browser.new_context(ignore_https_errors=True, locale="fr-FR")
    page = fallback.new_page()
    page.goto(base, wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="Welcome back")).to_be_visible()
    expect(page.locator("html")).to_have_attribute("lang", "en")
    fallback.close()
    assert not errors, errors
    return {"realBackendFirstRun": True, "resumedAfterReload": True, "optionalWizard": True, "localeSwitch": True, "liveDashboard": True, "pageErrors": errors}


def main() -> None:
    engine = sys.argv[1] if len(sys.argv) > 1 else "chromium"
    with tempfile.TemporaryDirectory(prefix="castorice-first-run-") as directory:
        work = Path(directory)
        config = json.loads((ROOT / "server/config.example.json").read_text())
        config.update(database_path=str(work / "state.db"), bootstrap_token_path=str(work / "bootstrap"), login_background_directory=str(work / "images"))
        (work / "config.json").write_text(json.dumps(config))
        def generate_token():
            subprocess.run([sys.executable, "server/run.py", "--config", str(work / "config.json"), "--generate-bootstrap"],
                           cwd=ROOT, check=True, capture_output=True, timeout=15)
            return (work / "bootstrap").read_text(encoding="utf-8").strip()

        with (work / "backend.log").open("w") as log:
            backend = subprocess.Popen([sys.executable, "server/run.py", "--config", str(work / "config.json")], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(60):
                    try:
                        with urllib.request.urlopen("http://127.0.0.1:18080/api/v2/health", timeout=1) as response:
                            if json.load(response)["setupRequired"]:
                                break
                    except OSError:
                        time.sleep(0.2)
                else:
                    raise RuntimeError("Temporary backend did not become ready")
                with sync_playwright() as playwright:
                    browser = getattr(playwright, engine).launch()
                    result = exercise(browser, generate_token)
                    browser.close()
                print(json.dumps({"engine": engine, **result}))
            except BaseException:
                print((work / "backend.log").read_text(errors="replace")[-3000:])
                raise
            finally:
                backend.terminate()
                backend.wait(timeout=12)


if __name__ == "__main__":
    main()
