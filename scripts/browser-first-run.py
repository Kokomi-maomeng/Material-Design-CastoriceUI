"""Browser workflow against a real temporary Linux backend, without API routes."""
from __future__ import annotations
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    engine = sys.argv[1] if len(sys.argv) > 1 else "chromium"
    with tempfile.TemporaryDirectory(prefix="castorice-first-run-") as directory:
        work = Path(directory)
        config = json.loads((ROOT / "server/config.example.json").read_text())
        config.update(database_path=str(work / "state.db"), bootstrap_token_path=str(work / "bootstrap"), login_background_directory=str(work / "images"))
        (work / "config.json").write_text(json.dumps(config))
        token = "synthetic-browser-first-run-token"
        (work / "bootstrap").write_text(token)
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
                    context = browser.new_context(ignore_https_errors=True)
                    context.add_init_script("localStorage.setItem('castorice-language', 'en')")
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(type(error).__name__))
                    page.goto("https://127.0.0.1:5173/", wait_until="networkidle")
                    page.get_by_label("One-time bootstrap token").fill(token)
                    page.get_by_label("Username", exact=True).fill("qa-admin")
                    page.get_by_label("Password", exact=True).fill("Synthetic-Password-123!")
                    page.get_by_role("button", name="Create and continue").click()
                    page.get_by_role("heading", name="Confirm live data integrations").wait_for()
                    page.get_by_label("Node display name").fill("QA real backend")
                    page.get_by_label("Total traffic quota (GB)").fill("2048")
                    page.get_by_role("button", name="Save basics").click()
                    page.get_by_role("button", name="Saved", exact=True).wait_for()
                    page.get_by_role("button", name="Finish and open dashboard").click()
                    page.get_by_role("heading", name="QA real backend").wait_for()
                    actual = context.request.get("https://127.0.0.1:5173/api/v2/dashboard").json()
                    assert actual["overview"]["trafficLimitBytes"] == 2_048_000_000_000
                    page.reload(wait_until="networkidle")
                    page.get_by_role("heading", name="QA real backend").wait_for()
                    assert not errors, errors
                    browser.close()
                print(json.dumps({"engine": engine, "realBackendFirstRun": True, "pageErrors": errors}))
            except BaseException:
                print((work / "backend.log").read_text(errors="replace")[-3000:])
                raise
            finally:
                backend.terminate()
                backend.wait(timeout=12)


if __name__ == "__main__":
    main()
