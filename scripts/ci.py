"""Small CI planner: bind results to inputs and reuse only trusted, fresh evidence."""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1
MAX_AGE = 24 * 3600
SUITES = {
    "layout": ("browser-matrix.py", "browser-v46.py", "browser-first-run.py", "browser-v47.py", "browser-v521.py"),
    "behavior": ("browser-v57.py", "browser-v56.py", "browser-v532.py", "browser-v53.py", "browser-v52.py", "browser-v51.py", "browser-v50.py"),
}
ENGINES = ("chromium", "firefox", "webkit")
EXPECTED = {"layout": [f"layout-{e}" for e in ENGINES], "behavior": [f"behavior-{e}" for e in ENGINES], "vm": ["vm-12", "vm-13"]}


def git(*args, root=ROOT):
    return subprocess.check_output(["git", *args], cwd=root).decode("utf-8").strip()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fresh(value, now):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= now - value <= MAX_AGE


def content_fingerprint(domain, root=ROOT):
    files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z", root=root).split("\0")
    result = []
    for name in sorted(filter(None, files)):
        if name.startswith("scripts/browser-") and name.endswith(".py"):
            if domain == "vm" or Path(name).name not in SUITES[domain]:
                continue
        if domain == "vm" and (name.startswith("tests/") or name in ("scripts/browser_fixture.py", "scripts/qa_browser.py", "scripts/run-browser-suite.py")):
            continue
        path = root / name
        if path.is_file():
            result.append((name, hashlib.sha256(path.read_bytes()).hexdigest()))
    return digest(result)


def environment():
    def version(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return "unavailable"
    return {"image": os.getenv("ImageOS", platform.system()), "imageVersion": os.getenv("ImageVersion", "local"),
            "python": platform.python_version(), "node": subprocess.check_output(["node", "--version"], text=True).strip(),
            "playwright": version("playwright"), "yaml": version("PyYAML")}


def official_images():
    result = {}
    for number, suite in (("12", "bookworm"), ("13", "trixie")):
        with urllib.request.urlopen(f"https://cloud.debian.org/images/cloud/{suite}/latest/SHA512SUMS", timeout=20) as response:
            lines = response.read(1024 * 1024).decode().splitlines()
        name = f"debian-{number}-genericcloud-amd64.qcow2"
        result[number] = next(line.split()[0] for line in lines if len(line.split()) == 2 and line.split()[1].lstrip("*") == name)
    return result


class Github:
    def __init__(self, repository, token):
        self.base = f"https://api.github.com/repos/{repository}/"
        self.token = token

    def get(self, path, binary=False):
        request = urllib.request.Request(self.base + path, headers={"Accept": "application/vnd.github+json", "Authorization": "Bearer " + self.token})
        # urllib removes Authorization on redirects only with this explicit handler.
        class Redirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
                if redirected is not None:
                    redirected.remove_header("Authorization")
                return redirected
        with urllib.request.build_opener(Redirect).open(request, timeout=20) as response:
            data = response.read(2 * 1024 * 1024)
        return data if binary else json.loads(data)


def eligible(plan, run, manifest, now):
    """No fork evidence, changed policy, stale success or main tree substitution."""
    if not isinstance(manifest, dict):
        return False
    if run.get("status") != "completed" or (run.get("head_repository") or {}).get("full_name", "").lower() != plan["repository"].lower():
        return False
    if run.get("event") != "pull_request" or manifest.get("schema") != SCHEMA:
        return False
    if str(manifest.get("runId")) != str(run.get("id")) or manifest.get("headSha") != run.get("head_sha"):
        return False
    if manifest.get("repository") != plan["repository"] or manifest.get("policy") != plan["policy"]:
        return False
    if not fresh(manifest.get("createdAt"), now):
        return False
    if plan["event"] == "pull_request":
        return bool(plan.get("prNumber")) and manifest.get("prNumber") == plan["prNumber"] and run.get("head_branch") == plan["branch"]
    return plan["event"] == "push" and manifest.get("checkoutTree") == plan["checkoutTree"]


def reusable(plan, manifest, domain, now):
    records = manifest.get("results", {})
    keys = EXPECTED[domain]
    if not isinstance(records, dict) or not plan["reuseAvailable"].get(domain):
        return False
    return all(
        isinstance(records.get(key), dict) and records[key].get("status") == "passed"
        and records[key].get("fingerprint") == plan["fingerprints"][domain]
        and records[key].get("contentFingerprint") == plan["contentFingerprints"][domain]
        and fresh(records[key].get("checkedAt"), now)
        for key in keys
    )


def inherit(plan, api, now):
    runs = api.get("actions/workflows/ci.yml/runs?status=completed&per_page=10")["workflow_runs"]
    for run in runs:
        if not any(domain not in plan["inherited"] for domain in EXPECTED):
            break
        if run.get("event") != "pull_request" or (run.get("head_repository") or {}).get("full_name", "").lower() != plan["repository"].lower():
            continue
        if plan["event"] == "pull_request" and run.get("head_branch") != plan["branch"]:
            continue
        artifacts = api.get(f"actions/runs/{run['id']}/artifacts")["artifacts"]
        artifact = next((a for a in artifacts if a["name"] == "castorice-ci-evidence-v1" and not a["expired"]), None)
        if artifact is None:
            continue
        archive = api.get(f"actions/artifacts/{artifact['id']}/zip", binary=True)
        if artifact.get("digest") and artifact["digest"] != "sha256:" + hashlib.sha256(archive).hexdigest():
            continue
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            member = bundle.getinfo("manifest.json")
            if member.file_size > 1024 * 1024:
                continue
            manifest = json.loads(bundle.read(member))
        if not eligible(plan, run, manifest, now):
            continue
        for domain in EXPECTED:
            if domain not in plan["inherited"] and reusable(plan, manifest, domain, now):
                plan["inherited"][domain] = {key: {**manifest["results"][key], "inheritedFrom": run["id"]} for key in EXPECTED[domain]}


def make_plan(root=ROOT, allow_network=True):
    now = time.time()
    env = environment()
    contents = {d: content_fingerprint(d, root) for d in EXPECTED}
    plan = {"schema": SCHEMA, "createdAt": now, "runId": os.getenv("GITHUB_RUN_ID", "local"),
            "repository": os.getenv("GITHUB_REPOSITORY", "local"), "event": os.getenv("GITHUB_EVENT_NAME", "local"),
            "branch": os.getenv("GITHUB_HEAD_REF", ""), "headSha": os.getenv("CI_HEAD_SHA", git("rev-parse", "HEAD", root=root)),
            "prNumber": os.getenv("CI_PR_NUMBER", ""),
            "baseSha": os.getenv("CI_BASE_SHA", ""),
            "checkoutCommit": git("rev-parse", "HEAD", root=root), "checkoutTree": git("rev-parse", "HEAD^{tree}", root=root),
            "environment": env, "images": {}, "contentFingerprints": contents, "inherited": {},
            "policy": digest([(name, hashlib.sha256((root / name).read_bytes()).hexdigest()) for name in ("scripts/ci.py", ".github/workflows/ci.yml")]),
            "reuseAvailable": {d: allow_network and env["imageVersion"] != "local" for d in EXPECTED}}
    if allow_network:
        try:
            plan["images"] = official_images()
        except (OSError, ValueError, StopIteration):
            plan["reuseAvailable"]["vm"] = False
    plan["fingerprints"] = {d: digest([contents[d], env, plan["images"] if d == "vm" else {}]) for d in EXPECTED}
    if allow_network and os.getenv("GITHUB_TOKEN") and plan["event"] in ("pull_request", "push"):
        try:
            inherit(plan, Github(plan["repository"], os.environ["GITHUB_TOKEN"]), now)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile):
            # Any uncertainty restores full execution; it never becomes a pass.
            plan["inherited"] = {}
            plan["reuseFallback"] = "evidence-unavailable"
    return plan


def record(plan, domain, key, status):
    assert key in EXPECTED[domain]
    contents = content_fingerprint(domain)
    env = environment()
    assert contents == plan["contentFingerprints"][domain], "inputs changed during CI"
    return {"key": key, "domain": domain, "status": status, "runId": plan["runId"], "checkedAt": time.time(),
            "contentFingerprint": contents, "fingerprint": digest([contents, env, plan["images"] if domain == "vm" else {}]),
            "environment": env, "inheritedFrom": None}


def merge(plan, records, job_results):
    results = {key: value for group in plan["inherited"].values() for key, value in group.items()}
    for value in records:
        key = value["key"]
        assert key not in results, "duplicate current/inherited evidence"
        domain = value["domain"]
        assert key in EXPECTED[domain] and value["runId"] == plan["runId"]
        assert value["contentFingerprint"] == plan["contentFingerprints"][domain]
        results[key] = value
    required = {key for keys in EXPECTED.values() for key in keys}
    complete = set(results) == required and all(v["status"] == "passed" for v in results.values())
    for name in ("validate", "nginx-template"):
        complete = complete and job_results.get(name, {}).get("result") == "success"
    for job, domains in (("browser-matrix", ("layout", "behavior")), ("linux-install", ("vm",))):
        expected = "skipped" if all(d in plan["inherited"] for d in domains) else "success"
        complete = complete and job_results.get(job, {}).get("result") == expected
    return {**{k: plan.get(k) for k in ("schema", "runId", "repository", "prNumber", "headSha", "baseSha", "checkoutCommit", "checkoutTree", "policy")},
            "createdAt": time.time(), "passed": bool(complete), "results": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "record", "merge"))
    parser.add_argument("--directory", type=Path, default=ROOT / "outputs/ci")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--domain", choices=tuple(EXPECTED))
    parser.add_argument("--key")
    parser.add_argument("--status", choices=("passed", "failed"))
    args = parser.parse_args()
    folder = args.directory
    if args.action == "plan":
        plan = make_plan(allow_network=not args.offline)
        write(folder / "plan.json", plan)
        matrix = [{"engine": e, "suite": d} for d in SUITES if d not in plan["inherited"] for e in ENGINES]
        outputs = {"browser": str(bool(matrix)).lower(), "vm": str("vm" not in plan["inherited"]).lower(), "matrix": json.dumps({"include": matrix}, separators=(",", ":"))}
        for number in ("12", "13"):
            outputs["image" + number] = plan["images"].get(number, "")
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
                stream.write("".join(f"{k}={v}\n" for k, v in outputs.items()))
        print(json.dumps({"checkoutTree": plan["checkoutTree"], "reused": list(plan["inherited"]), "browserJobs": len(matrix), "vmJobs": 0 if "vm" in plan["inherited"] else 2}))
    else:
        plan = json.loads((folder / "plan.json").read_text())
        if args.action == "record":
            write(folder / (args.key + ".json"), record(plan, args.domain, args.key, args.status))
        else:
            records = [json.loads(p.read_text()) for p in folder.glob("*.json") if p.name not in ("plan.json", "manifest.json")]
            result = merge(plan, records, json.loads(os.environ.get("JOB_RESULTS", "{}")))
            write(folder / "manifest.json", result)
            print(json.dumps({"passed": result["passed"], "checked": len(result["results"]), "inherited": sum(bool(v.get("inheritedFrom")) for v in result["results"].values())}))
            if not result["passed"]:
                raise SystemExit(1)


if __name__ == "__main__":
    main()
