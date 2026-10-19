"""Behavioral checks for fail-closed reuse, input invalidation and suite coverage."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import ci

spec = importlib.util.spec_from_file_location("suite_runner", SCRIPTS / "run-browser-suite.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.now = 100000
        self.plan = {"schema": 1, "runId": "22", "repository": "example/project", "event": "pull_request", "branch": "change", "prNumber": "7",
                     "checkoutCommit": "new", "checkoutTree": "tree", "headSha": "new", "policy": "policy",
                     "contentFingerprints": {d: d + "-content" for d in ci.EXPECTED},
                     "fingerprints": {d: d + "-environment" for d in ci.EXPECTED},
                     "reuseAvailable": {d: True for d in ci.EXPECTED}, "inherited": {}}
        self.run = {"id": 21, "status": "completed", "event": "pull_request", "head_branch": "change", "head_sha": "old", "head_repository": {"full_name": "example/project"}}
        self.manifest = {"schema": 1, "runId": "21", "headSha": "old", "repository": "example/project", "prNumber": "7", "checkoutTree": "tree", "policy": "policy", "createdAt": self.now - 100,
                         "results": {k: {"status": "passed", "checkedAt": self.now - 100, "contentFingerprint": d + "-content", "fingerprint": d + "-environment"} for d, keys in ci.EXPECTED.items() for k in keys}}

    def test_only_same_repository_same_pr_can_supply_partial_success(self):
        self.assertTrue(ci.eligible(self.plan, self.run, self.manifest, self.now))
        self.assertFalse(ci.eligible(self.plan, self.run, {**self.manifest, "prNumber": "8"}, self.now))
        for mutation in ({"head_repository": {"full_name": "fork/project"}}, {"head_repository": None}, {"head_branch": "other"}, {"status": "in_progress"}, {"event": "workflow_dispatch"}):
            with self.subTest(mutation=mutation):
                self.assertFalse(ci.eligible(self.plan, {**self.run, **mutation}, self.manifest, self.now))

    def test_main_requires_actual_tree_and_policy_and_provenance(self):
        self.plan["event"] = "push"
        self.assertTrue(ci.eligible(self.plan, self.run, self.manifest, self.now))
        for key, value in (("checkoutTree", "other"), ("policy", "old-policy"), ("runId", "99"), ("headSha", "substituted"), ("schema", 99), ("createdAt", self.now + 5)):
            with self.subTest(key=key):
                self.assertFalse(ci.eligible(self.plan, self.run, {**self.manifest, key: value}, self.now))

    def test_domain_reuse_requires_all_parts_and_current_inputs(self):
        self.assertTrue(ci.reusable(self.plan, self.manifest, "vm", self.now))
        for key, value in (("status", "failed"), ("status", "cancelled"), ("fingerprint", "different-runtime"), ("contentFingerprint", "different-package"), ("checkedAt", self.now - ci.MAX_AGE - 1)):
            other = copy.deepcopy(self.manifest)
            other["results"]["vm-12"][key] = value
            self.assertFalse(ci.reusable(self.plan, other, "vm", self.now))
        del self.manifest["results"]["vm-13"]
        self.assertFalse(ci.reusable(self.plan, self.manifest, "vm", self.now))

    def test_inherited_copy_cannot_extend_original_expiry(self):
        self.manifest["createdAt"] = self.now
        self.manifest["results"]["vm-12"]["checkedAt"] = 1
        self.manifest["results"]["vm-12"]["inheritedFrom"] = 20
        self.assertFalse(ci.reusable(self.plan, self.manifest, "vm", self.now))

    def test_malformed_or_missing_evidence_cannot_supply_a_pass(self):
        for value in (None, "100", True, self.now + 1, self.now - ci.MAX_AGE - 1):
            self.assertFalse(ci.eligible(self.plan, self.run, {**self.manifest, "createdAt": value}, self.now))
        self.assertFalse(ci.eligible(self.plan, self.run, [], self.now))
        self.assertFalse(ci.reusable(self.plan, {**self.manifest, "results": []}, "vm", self.now))

    def test_skipped_jobs_require_complete_inherited_evidence(self):
        jobs = {name: {"result": "success"} for name in ("validate", "nginx-template", "browser-matrix", "linux-install")}
        records = []
        for domain, keys in ci.EXPECTED.items():
            for key in keys:
                records.append({**self.manifest["results"][key], "domain": domain, "key": key, "runId": "22"})
        self.assertTrue(ci.merge(self.plan, records, jobs)["passed"])
        jobs["linux-install"]["result"] = "skipped"
        self.assertFalse(ci.merge(self.plan, records, jobs)["passed"])
        self.plan["inherited"]["vm"] = {k: self.manifest["results"][k] for k in ci.EXPECTED["vm"]}
        records = [r for r in records if r["domain"] != "vm"]
        self.assertTrue(ci.merge(self.plan, records, jobs)["passed"])
        jobs["validate"]["result"] = "cancelled"
        self.assertFalse(ci.merge(self.plan, records, jobs)["passed"])

    def test_all_suites_remain_in_exactly_one_shard(self):
        expected = {"browser-matrix.py", "browser-v46.py", "browser-first-run.py", "browser-v47.py", "browser-v50.py", "browser-v51.py", "browser-v52.py", "browser-v521.py", "browser-v53.py", "browser-v532.py"}
        actual = [name for names in ci.SUITES.values() for name in names]
        self.assertEqual(set(actual), expected)
        self.assertEqual(len(actual), len(expected))


class InputTests(unittest.TestCase):
    def test_browser_fixture_fix_does_not_invalidate_vm_but_backend_or_assets_do(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            files = {"scripts/browser-v46.py": "a", "scripts/browser-v532.py": "a", "server/tests/case.py": "a", "src/App.tsx": "a", "public/font.woff2": "a", "scripts/qa_browser.py": "a"}
            for name, text in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            original = {d: ci.content_fingerprint(d, root) for d in ci.EXPECTED}
            (root / "scripts/browser-v46.py").write_text("changed")
            self.assertEqual(ci.content_fingerprint("vm", root), original["vm"])
            self.assertEqual(ci.content_fingerprint("behavior", root), original["behavior"])
            self.assertNotEqual(ci.content_fingerprint("layout", root), original["layout"])
            for name in ("server/tests/case.py", "src/App.tsx", "public/font.woff2"):
                (root / name).write_text("changed")
                self.assertNotEqual(ci.content_fingerprint("vm", root), original["vm"])
                (root / name).write_text("a")
            (root / "scripts/qa_browser.py").write_text("shared-wait-changed")
            self.assertNotEqual(ci.content_fingerprint("layout", root), original["layout"])
            self.assertNotEqual(ci.content_fingerprint("behavior", root), original["behavior"])


if __name__ == "__main__":
    unittest.main()
