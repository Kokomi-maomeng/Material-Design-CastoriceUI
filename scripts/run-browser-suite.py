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
        passed = exit_code == 0 and bool(reports)
        if name == "browser-matrix.py":
            passed = passed and any(r.get("layoutCases") == r.get("uniqueConditions") == 400 and not r.get("javascriptErrors") for r in reports)
        if name in ("browser-v51.py", "browser-v52.py"):
            passed = passed and any(r.get("apiRoutesMocked") is False and r.get("cases") and not r.get("backendErrors") for r in reports)
        if name == "browser-v532.py":
            passed = passed and any(len(r.get("motionCases", [])) == 4 and r.get("passed") for r in reports)
        result = {"suite": name, "engine": args.engine, "passed": passed, "exitCode": exit_code,
                  "seconds": round(time.monotonic() - start, 2)}
        write(log.with_suffix(".json"), {**result, "reports": reports})
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
