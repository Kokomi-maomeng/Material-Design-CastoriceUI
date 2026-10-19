"""Run existing suites once, changed suites first, with compact timed output."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from ci import ROOT, SUITES, git, write


def ordered(suite, base):
    names = list(SUITES[suite])
    if not base:
        return names
    try:
        changed = set(git("diff", "--name-only", base, "HEAD").splitlines())
    except subprocess.CalledProcessError:
        return names
    return sorted(names, key=lambda name: "scripts/" + name not in changed)


def valid_reports(name, reports):
    """Move the existing release coverage gate into CI, before acceptance."""
    def one(key, check):
        final = [r for r in reports if key in r]
        return len(final) == 1 and check(final[0])
    if name == "browser-matrix.py":
        return one("layoutCases", lambda r: r.get("layoutCases") == r.get("uniqueConditions") == 400 and not r.get("javascriptErrors"))
    if name == "browser-v46.py":
        return len(reports) == 3 and {r.get("timeZone") for r in reports} == {"Asia/Shanghai", "America/New_York", "Europe/Berlin"} and all(r.get("dialogCases") == 75 and r.get("pendingPersistenceAndPagination") and not r.get("javascriptErrors") for r in reports)
    if name in ("browser-v51.py", "browser-v52.py"):
        expected = 6 if name == "browser-v51.py" else 12
        return one("apiRoutesMocked", lambda r: r["apiRoutesMocked"] is False and len(r.get("cases", [])) == expected and not r.get("backendErrors")
                   and (name != "browser-v52.py" or all(all(c.get(k) for k in ("immediateToggle", "scrollPreserved", "combinedFilters", "calendarPortal", "logLocator")) for c in r["cases"]))
                   and (name != "browser-v51.py" or sum(c.get("realLogoutAndLoginReturn") is True for c in r["cases"]) == 2))
    if name == "browser-v532.py":
        return one("motionCases", lambda r: r.get("passed") and r.get("pageErrors") == 0 and len(r["motionCases"]) == 4
                   and all(c.get("routes") == 10 and c.get("frameMeasurement") == "native-browser-timeline"
                           and (c.get("reducedMotion") or c.get("glassIntermediateFrames", 0) >= 3)
                           and all(c.get(k) for k in ("nativeSummaryKeyboard", "rapidReversal", "failedSignOutRestoresScreen", "logoutRemovesPrivateDom", "logoutKeepsDocumentImage", "postLoginOverview"))
                           and c.get("settingsWrites") == 0 for c in r["motionCases"]))
    if name == "browser-v53.py":
        return one("opticalCases", lambda r: r.get("passed") and len(r["opticalCases"]) == 18 and not r.get("pageErrors")
                   and r.get("opticalProof", {}).get("differentRenderedPixels") and r["opticalProof"].get("noDisplacement")
                   and all(r.get("controls", {}).get(k) for k in ("draftsPreserved", "continuousDrag", "snapsToPreset", "keyboardPresets", "menuExitFrames", "exitingMenuInert", "glassAppliedWithoutReload"))
                   and r.get("documentLifecycle", {}).get("firstLogoutPaintHasImage")
                   and r["documentLifecycle"].get("logoutCycles") == 3 and r["documentLifecycle"].get("authenticatedReloadPreloads"))
    if name == "browser-v50.py":
        return one("glassThemeViewportCases", lambda r: r["glassThemeViewportCases"] == 32 and r.get("pageErrors") == 0)
    if name == "browser-v521.py":
        return one("chartCases", lambda r: len(r["chartCases"]) == 20 and r.get("pageErrors") == 0 and all(c.get("ranges") == 5 for c in r["chartCases"]))
    if name == "browser-first-run.py":
        return one("realBackendFirstRun", lambda r: r["realBackendFirstRun"] and not r.get("pageErrors"))
    return bool(reports)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=("chromium", "firefox", "webkit"))
    parser.add_argument("suite", choices=tuple(SUITES))
    parser.add_argument("--base")
    parser.add_argument("--directory", type=Path, default=ROOT / "outputs/browser")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    # Browser/API tests must not depend on PR versus push metadata or credentials.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GITHUB_", "GH_"))}
    if sys.platform == "win32":
        env["PYTHONUTF8"] = "1"
    results = []
    for name in ordered(args.suite, args.base):
        command = [sys.executable, str(ROOT / "scripts" / name), args.engine]
        if name == "browser-v46.py" and args.engine == "firefox" and sys.platform == "linux":
            command = ["xvfb-run", "-a", *command]
        start = time.monotonic()
        log = args.directory / (args.engine + "-" + name.removesuffix(".py") + ".log")
        with log.open("wb") as stream:
            try:
                done = subprocess.run(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
                exit_code = done.returncode
            except subprocess.TimeoutExpired:
                exit_code = 124
        reports = []
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    reports.append(item)
            except ValueError:
                pass
        # A silent early return cannot become accepted browser evidence.
        passed = exit_code == 0 and valid_reports(name, reports)
        result = {"suite": name, "engine": args.engine, "passed": passed, "exitCode": exit_code,
                  "seconds": round(time.monotonic() - start, 2)}
        detail = {**result, "reports": reports}
        if not passed:
            detail["failureLog"] = log.read_text(encoding="utf-8", errors="replace")
        write(log.with_suffix(".json"), detail)
        results.append(result)
        print(json.dumps(result), flush=True)
        if not passed:
            # Keep the complete raw log; only the failure tail enters model context.
            print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-24:]), file=sys.stderr)
            break
    passed = len(results) == len(SUITES[args.suite]) and all(r["passed"] for r in results)
    write(args.directory / f"{args.engine}-{args.suite}-summary.json", {"passed": passed, "results": results})
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
