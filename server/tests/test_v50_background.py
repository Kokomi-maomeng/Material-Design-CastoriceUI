"""Cache lifecycle, privacy, concurrency and transfer bounds using synthetic images."""
import http.client
from http import HTTPStatus
import json
import runpy
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from castoriceui.background import BackgroundCache, BackgroundUnavailable, CACHE_SECONDS, PROFILES, background_setting
from castoriceui.api import ApiServer
from castoriceui.config import AppConfig
from castoriceui.dashboard import DashboardService
from castoriceui.security import fetch_https_image_api
from castoriceui.storage import Storage

PNG = b"\x89PNG\r\n\x1a\n" + b"synthetic-image"
URL = "https://images.example.com/random"


class BackgroundTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.cache = BackgroundCache(self.root / "cache")
        self.now = 1000.0
        self.clock = patch("castoriceui.background.time.monotonic", side_effect=lambda: self.now)
        self.wall = patch("castoriceui.background.time.time", side_effect=lambda: self.now + 100000)
        self.clock.start(); self.wall.start()
        self.fetch = patch("castoriceui.background.fetch_https_image_api", return_value=(PNG, "image/png", URL)).start()

    def tearDown(self):
        patch.stopall()
        self.temp.cleanup()

    def get(self, profile="landscape-1920", seconds=0):
        return self.cache.get(URL, [], profile, seconds)

    def test_immediate_reload_and_logout_fetch_again_with_safe_burst_coalescing(self):
        self.get(); self.now += 1.1; self.get()
        self.assertEqual(self.fetch.call_count, 2)
        for _ in range(100):
            self.assertTrue(self.get().stale)
        self.assertEqual(self.fetch.call_count, 2)

    def test_every_supported_duration_holds_until_expiry_including_two_seconds(self):
        for seconds in CACHE_SECONDS[1:]:
            with self.subTest(seconds=seconds):
                self.cache = BackgroundCache(self.root / str(seconds))
                start = self.now
                first = self.get(seconds=seconds)
                count = self.fetch.call_count
                self.now = start + seconds - .01
                self.assertEqual(self.get(seconds=seconds), first)
                self.assertEqual(self.fetch.call_count, count)
                self.now = start + seconds
                self.assertGreater(self.get(seconds=seconds).fetched_at, first.fetched_at)
                self.assertEqual(self.fetch.call_count, count + 1)

    def test_phone_1080p_and_2k_have_independent_images_and_expiries(self):
        self.fetch.side_effect = lambda *_a, **kw: (PNG + str(kw["viewport"]).encode(), "image/png", URL)
        desktop = self.get(seconds=60); desktop_bytes = desktop.path.read_bytes()
        self.now += 5
        phone = self.get("portrait-640", 60)
        self.now += 5
        large = self.get("landscape-2560", 60)
        self.assertEqual(len({desktop_bytes, phone.path.read_bytes(), large.path.read_bytes()}), 3)
        self.now = 1060
        self.assertGreater(self.get(seconds=60).fetched_at, desktop.fetched_at)
        self.assertEqual(self.get("portrait-640", 60).fetched_at, phone.fetched_at)
        self.assertEqual(self.get("landscape-2560", 60).fetched_at, large.fetched_at)

    def test_expired_image_survives_failures_backoff_and_restart_then_recovers(self):
        first = self.get(seconds=60)
        self.now += 61
        self.fetch.side_effect = ValueError("synthetic outage")
        stale = self.get(seconds=60)
        self.assertTrue(stale.stale); self.assertEqual(stale.path.read_bytes(), PNG)
        count = self.fetch.call_count
        self.assertTrue(self.get(seconds=60).stale)
        self.assertEqual(self.fetch.call_count, count)
        # A backend restart restores the previous successful file and timestamp.
        self.cache = BackgroundCache(self.root / "cache")
        self.assertTrue(self.get(seconds=60).stale)
        self.now += 31
        self.fetch.side_effect = None
        self.fetch.return_value = (PNG + b"new", "image/png", URL)
        new = self.get(seconds=60)
        self.assertFalse(new.stale); self.assertGreater(new.fetched_at, first.fetched_at)
        self.assertEqual(new.path.read_bytes(), PNG + b"new")

    def test_cold_failure_retries_after_backoff_instead_of_permanent_blank(self):
        self.fetch.side_effect = ValueError("synthetic")
        with self.assertRaises(BackgroundUnavailable) as error: self.get()
        self.assertEqual(error.exception.retry_after, 2)
        for _ in range(10):
            with self.assertRaises(BackgroundUnavailable): self.get()
        self.assertEqual(self.fetch.call_count, 1)
        self.now += 2
        self.fetch.side_effect = None
        self.assertEqual(self.get().path.read_bytes(), PNG)

    def test_arbitrary_sizes_and_query_identities_cannot_grow_profiles(self):
        for i in range(1000):
            with self.assertRaises(ValueError): self.get(f"untrusted-{i}")
        self.assertEqual(self.fetch.call_count, 0)
        self.assertFalse(self.cache.directory.exists())

    def test_global_attempt_budget_is_shared_across_all_profiles(self):
        for i in range(100):
            self.now = 1000 + i * .3
            try: self.get(tuple(PROFILES)[i % len(PROFILES)])
            except BackgroundUnavailable: pass
        self.assertLessEqual(self.fetch.call_count, BackgroundCache.MAX_ATTEMPTS)
        self.assertLessEqual(len(list(self.cache.directory.glob("*.image"))), len(PROFILES))

    def test_global_byte_budget_reserves_one_maximum_response(self):
        with patch("castoriceui.background.MAX_IMAGE_BYTES", len(PNG)), patch.object(self.cache, "MAX_WINDOW_BYTES", len(PNG) * 3):
            for i in range(10):
                self.now += 2
                try: self.get(tuple(PROFILES)[i % len(PROFILES)])
                except BackgroundUnavailable: pass
        self.assertEqual(self.fetch.call_count, 3)

    def test_slow_upstream_never_queues_all_request_workers(self):
        first = self.get()
        self.now += 2
        entered, release = threading.Event(), threading.Event()
        def blocked(*_a, **_kw):
            entered.set(); release.wait(2); return PNG, "image/png", URL
        self.fetch.side_effect = blocked
        worker = threading.Thread(target=self.get)
        worker.start(); self.assertTrue(entered.wait(1))
        started = time.perf_counter()
        for _ in range(20):
            self.assertEqual(self.get().path, first.path)
            with self.assertRaises(BackgroundUnavailable): self.get("portrait-640")
        self.assertLess(time.perf_counter() - started, .3)
        release.set(); worker.join(2)
        self.assertEqual(self.fetch.call_count, 2)

    def test_source_change_drops_only_managed_cache_files(self):
        self.get(); self.now += 2
        private = self.cache.directory / "operator-note.txt"
        private.write_text("synthetic")
        self.cache.get("https://images.example.com/other", [], seconds=60)
        self.assertTrue(private.is_file())
        self.assertEqual(len(list(self.cache.directory.glob("*.image"))), 1)

    def test_corrupt_metadata_does_not_break_image_refresh(self):
        image = self.get()
        image.path.with_suffix(".json").write_text('{"fetchedAt":NaN}')
        self.cache = BackgroundCache(self.root / "cache"); self.now += 2
        self.assertFalse(self.get(seconds=60).stale)
        self.assertEqual(self.fetch.call_count, 2)

    def test_failed_disk_publication_keeps_previous_image_and_removes_temporary_bytes(self):
        previous = self.get(); self.now += 2
        with patch.object(Path, "replace", side_effect=OSError("synthetic disk failure")):
            fallback = self.get()
        self.assertTrue(fallback.stale)
        self.assertEqual(fallback.path.read_bytes(), PNG)
        self.assertFalse(previous.path.with_suffix(".tmp").exists())
        orphan = previous.path.with_suffix(".tmp"); orphan.write_bytes(b"interrupted")
        operator = self.cache.directory / "operator.tmp"; operator.write_bytes(b"keep")
        self.cache = BackgroundCache(self.root / "cache")
        self.get(seconds=60)
        self.assertFalse(orphan.exists()); self.assertTrue(operator.exists())

    def test_legacy_position_is_removed_and_defaults_migrate_safely(self):
        setting = background_setting({"type": "url", "value": URL, "position": "left", "fit": "contain"})
        self.assertNotIn("position", setting)
        self.assertEqual((setting["value"], setting["fit"], setting["cacheSeconds"], setting["glass"], setting["glassEnabled"]), (URL, "contain", 0, "default", False))
        for value in (None, [], {"type": [], "glass": {}, "fit": [], "cacheSeconds": True}):
            self.assertEqual(background_setting(value)["cacheSeconds"], 0)

    def test_upgrade_adds_only_blob_image_permission_and_is_idempotent(self):
        rewrite = runpy.run_path(str(Path(__file__).resolve().parents[2] / "deploy/install_release.py"))["allow_login_image_blobs"]
        old = 'add_header Content-Security-Policy "default-src \'self\'; script-src \'self\'; img-src \'self\' data:; object-src \'none\'" always;\n'
        old += 'add_header Content-Security-Policy "img-src \'none\'; frame-ancestors \'none\'" always;\n'
        old += 'proxy_pass http://127.0.0.1:18080; # operator setting\n'
        updated = rewrite(old)
        self.assertIn("img-src 'self' data: blob:;", updated)
        self.assertIn('"img-src blob:;', updated)
        self.assertIn("script-src 'self';", updated)
        self.assertIn("object-src 'none'", updated)
        self.assertIn("# operator setting", updated)
        self.assertEqual(rewrite(updated), updated)

    def test_30mb_boundary_and_synthetic_layout_headers(self):
        headers = http.client.HTTPMessage(); headers["Content-Type"] = "image/png"
        body = PNG + bytes(30_000_000 - len(PNG))
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, body)) as request:
            self.assertEqual(len(fetch_https_image_api(URL, viewport=(640, 1136))[0]), 30_000_000)
            sent = request.call_args.args[1]
            self.assertIn("Mobile", sent["User-Agent"])
            self.assertEqual(sent["Viewport-Width"], "640")
            self.assertNotIn("Cookie", sent)
            self.assertNotIn("X-Forwarded-For", sent)
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, body + b"x")):
            with self.assertRaises(ValueError): fetch_https_image_api(URL)

    def test_redirect_keeps_only_synthetic_request_headers(self):
        redirect = http.client.HTTPMessage()
        redirect["Location"] = "https://images.example.com/next"
        redirect["Set-Cookie"] = "provider=synthetic"
        redirect["Server"] = "synthetic-provider"
        final = http.client.HTTPMessage(); final["Content-Type"] = "image/png"
        with patch("castoriceui.security._public_https_get", side_effect=[(302, redirect, b""), (200, final, PNG)]) as request:
            self.assertEqual(fetch_https_image_api(URL, viewport=(640, 1136))[0], PNG)
            for call in request.call_args_list:
                sent = call.args[1]
                self.assertIn("Mobile", sent["User-Agent"])
                self.assertEqual(sent["Viewport-Width"], "640")
                self.assertNotIn("Cookie", sent)
                self.assertNotIn("Set-Cookie", sent)
                self.assertNotIn("Server", sent)

    def test_refresh_varies_only_initial_api_request_and_keeps_signed_urls_intact(self):
        headers = http.client.HTTPMessage(); headers["Content-Type"] = "image/png"
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, PNG)) as request:
            for _ in range(2): fetch_https_image_api(URL + "?format=png")
            targets = [call.args[0] for call in request.call_args_list]
            self.assertNotEqual(*targets)
            self.assertTrue(all(target.startswith(URL + "?format=png&_castorice_refresh=") for target in targets))
        signed = URL + "?X-Amz-Signature=synthetic"
        with patch("castoriceui.security._public_https_get", return_value=(200, headers, PNG)) as request:
            fetch_https_image_api(signed)
            self.assertEqual(request.call_args.args[0], signed)
        envelope = http.client.HTTPMessage(); envelope["Content-Type"] = "application/json"
        destination = URL + "/image?asset=synthetic"
        with patch("castoriceui.security._public_https_get", side_effect=[(200, envelope, json.dumps({"url": destination}).encode()), (200, headers, PNG)]) as request:
            fetch_https_image_api(URL)
            self.assertEqual(request.call_args_list[1].args[0], destination)

    def test_deleted_random_cdn_image_rerolls_origin_once_inside_hop_budget(self):
        redirect = http.client.HTTPMessage(); redirect["Location"] = URL + "/deleted"
        headers = http.client.HTTPMessage(); headers["Content-Type"] = "image/png"
        with patch("castoriceui.security._public_https_get", side_effect=[(302, redirect, b""), (404, headers, b"missing"), (302, redirect, b""), (200, headers, PNG)]) as request:
            self.assertEqual(fetch_https_image_api(URL)[0], PNG)
            calls = [call.args[0] for call in request.call_args_list]
            self.assertTrue(calls[0].startswith(URL + "?_castorice_refresh="))
            self.assertTrue(calls[2].startswith(URL + "?_castorice_refresh="))
            self.assertNotEqual(calls[0], calls[2]); self.assertEqual(calls[1], calls[3])
        with patch("castoriceui.security._public_https_get", side_effect=[(302, redirect, b""), (404, headers, b"missing"), (302, redirect, b""), (404, headers, b"missing")]) as request:
            with self.assertRaisesRegex(ValueError, "HTTP 404"): fetch_https_image_api(URL)
            self.assertEqual(request.call_count, 4)


class BackgroundHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.config = AppConfig(database_path=str(self.root / "state.db"), listen_port=0, secure_cookies=False)
        self.storage = Storage(self.config.database_path)
        self.storage.set_setting("login_background", {"type": "url", "value": URL, "position": "left"})
        self.server = ApiServer(self.config, self.storage, DashboardService(self.config, self.storage))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2); self.temp.cleanup()

    def request(self, path, headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        client.request("GET", path, headers=headers or {})
        response = client.getresponse(); result = response.status, dict(response.getheaders()), response.read()
        client.close(); return result

    def test_http_cold_failure_recovery_and_stale_response_never_set_cookies(self):
        with patch("castoriceui.background.fetch_https_image_api", side_effect=ValueError("synthetic")):
            status, headers, _ = self.request("/api/v2/auth/background?profile=portrait-640")
            self.assertEqual(status, 503); self.assertIn("Retry-After", headers)
            self.assertNotIn("Set-Cookie", headers)
        self.server.backgrounds.next_fetch = 0
        with patch("castoriceui.background.fetch_https_image_api", return_value=(PNG, "image/png", URL)):
            status, headers, body = self.request("/api/v2/auth/background?profile=portrait-640")
            self.assertEqual((status, body), (200, PNG)); self.assertEqual(headers["Cache-Control"], "no-store")
            status, headers, body = self.request("/api/v2/auth/background?profile=portrait-640", {"User-Agent": "different browser", "X-Forwarded-For": "192.0.2.1"})
            self.assertEqual((status, body), (200, PNG)); self.assertEqual(headers["X-Background-Stale"], "1")
            self.assertNotIn("Set-Cookie", headers)
        self.assertNotIn("position", self.storage.get_setting("login_background", {}))

    def test_bad_profile_does_not_fetch_and_bootstrap_exposes_only_revision(self):
        with patch("castoriceui.background.fetch_https_image_api") as fetch:
            self.assertEqual(self.request("/api/v2/auth/background?profile=arbitrary-123")[0], 400)
            self.assertFalse(fetch.called)
        appearance = json.loads(self.request("/api/v2/bootstrap")[2])["appearance"]
        self.assertNotIn("value", appearance); self.assertNotIn("position", appearance)
        self.assertEqual(appearance["cacheSeconds"], 0); self.assertEqual(appearance["glass"], "default")
        self.assertNotIn(URL.encode(), self.request("/api/v2/bootstrap")[2])

    def test_http_age_describes_original_fetch_without_renewing_cached_ttl(self):
        self.storage.set_setting("login_background", {"type": "url", "value": URL, "cacheSeconds": 60})
        with patch("castoriceui.background.fetch_https_image_api", return_value=(PNG, "image/png", URL)) as fetch:
            self.assertEqual(self.request("/api/v2/auth/background")[0], 200)
            image = self.server.backgrounds.entries["landscape-1920"]
            from dataclasses import replace
            self.server.backgrounds.entries["landscape-1920"] = replace(image, fetched_at=time.time() - 40)
            status, headers, _ = self.request("/api/v2/auth/background")
            self.assertEqual(status, 200); self.assertGreaterEqual(float(headers["X-Background-Age"]), 40)
            self.assertEqual(fetch.call_count, 1)

    def test_visual_settings_preserve_image_identity_but_source_changes_invalidate(self):
        def appearance():
            return json.loads(self.request("/api/v2/bootstrap")[2])["appearance"]
        initial = appearance()
        self.storage.set_setting("login_background", {"type": "url", "value": URL, "glassEnabled": True, "glass": "tinted", "fit": "contain", "cacheSeconds": 60})
        changed = appearance()
        self.assertEqual(initial["revision"], changed["revision"])
        self.assertTrue(changed["glassEnabled"])
        self.assertEqual(changed["glass"], "tinted")
        self.storage.set_setting("login_background", {"type": "url", "value": URL + "?different=1"})
        self.assertNotEqual(initial["revision"], appearance()["revision"])

    def test_slow_image_fetch_leaves_health_responsive(self):
        entered, release = threading.Event(), threading.Event()
        def slow(*_a, **_kw):
            entered.set(); release.wait(2); return PNG, "image/png", URL
        with patch("castoriceui.background.fetch_https_image_api", side_effect=slow):
            worker = threading.Thread(target=lambda: self.request("/api/v2/auth/background")); worker.start()
            self.assertTrue(entered.wait(1))
            start = time.perf_counter()
            for i in range(20): self.assertEqual(self.request("/api/v2/auth/background?profile=portrait-640")[0], 503)
            self.assertEqual(self.request("/api/v2/health")[0], 200)
            self.assertLess(time.perf_counter() - start, 1)
            release.set(); worker.join(2)

    def test_settings_round_trip_all_durations_glass_and_invalid_values(self):
        user = self.storage.create_initial_user("qa-admin", "Synthetic-Password-123!")
        token, csrf, _ = self.storage.create_session(user, 3600)
        def put(payload):
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
            client.request("PUT", "/api/v2/settings/login-background", json.dumps(payload), {"Content-Type": "application/json", "Cookie": "castorice_session=" + token, "X-CastoriceUI-Request": "1", "X-CSRF-Token": csrf})
            response = client.getresponse(); result = response.status, json.loads(response.read()); client.close(); return result
        for seconds in CACHE_SECONDS:
            for glass in ("clear", "default", "tinted"):
                setting = {"type": "url", "value": URL, "fit": "contain", "cacheSeconds": seconds, "glass": glass, "glassEnabled": False}
                status, appearance = put(setting)
                self.assertEqual(status, 200)
                self.assertEqual(self.storage.get_setting("login_background", {}), setting)
                self.assertEqual((appearance["cacheSeconds"], appearance["glass"], appearance["glassEnabled"]), (seconds, glass, False))
        before = self.storage.get_setting("login_background", {})
        for key, bad in (("cacheSeconds", True), ("cacheSeconds", 900), ("cacheSeconds", "60"), ("glass", []), ("glass", "unknown"), ("glassEnabled", "false"), ("fit", "left")):
            status, _ = put({**before, key: bad})
            self.assertEqual(status, 400, (key, bad))
            self.assertEqual(self.storage.get_setting("login_background", {}), before)

    def test_decode_retry_bypasses_ttl_but_keeps_global_burst_budget(self):
        self.storage.set_setting("login_background", {"type": "url", "value": URL, "cacheSeconds": 600})
        with patch("castoriceui.background.fetch_https_image_api", return_value=(PNG, "image/png", URL)) as fetch:
            self.assertEqual(self.request("/api/v2/auth/background")[0], 200)
            self.server.backgrounds.next_fetch = 0
            self.assertEqual(self.request("/api/v2/auth/background")[0], 200)
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(self.request("/api/v2/auth/background?retry=1")[0], 200)
            self.assertEqual(fetch.call_count, 2)
            for _ in range(10): self.assertEqual(self.request("/api/v2/auth/background?retry=1")[0], 200)
            self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__": unittest.main()
