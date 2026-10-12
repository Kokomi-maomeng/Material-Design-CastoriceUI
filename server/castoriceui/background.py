"""Finite, identity-free login image cache with one bounded upstream fetch.

Only coarse viewport classes are accepted. Images live on disk rather than
retaining up to eight 30 MB bodies in the panel's small memory budget.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import threading
import time

from .security import fetch_https_image_api, normalize_https_image_url, _image_mime

CACHE_SECONDS = (0, 2, 5, 10, 30, 60, 120, 300, 600)
MAX_IMAGE_BYTES = 30_000_000  # Decimal MB, consistent with the settings UI.
PROFILES = {
    "portrait-640": (640, 1136), "portrait-1280": (1280, 1920),
    "portrait-1920": (1920, 2560), "landscape-960": (960, 640),
    "landscape-1280": (1280, 720), "landscape-1920": (1920, 1080),
    "landscape-2560": (2560, 1440), "landscape-3840": (3840, 2160),
}
DEFAULT_PROFILE = "landscape-1920"


def background_setting(value: object) -> dict:
    """Migrate legacy position/15-minute defaults without changing the source."""
    old = value if isinstance(value, dict) else {}
    seconds = old.get("cacheSeconds", 0)
    def choice(key: str, allowed: set[str], fallback: str) -> str:
        item = old.get(key)
        return item if isinstance(item, str) and item in allowed else fallback
    return {
        "type": choice("type", {"default", "url", "server"}, "default"),
        "value": old.get("value", "") if isinstance(old.get("value", ""), str) else "",
        "fit": choice("fit", {"cover", "contain"}, "cover"),
        "cacheSeconds": seconds if type(seconds) is int and seconds in CACHE_SECONDS else 0,
        "glass": choice("glass", {"clear", "default", "tinted"}, "default"),
        "glassEnabled": old.get("glassEnabled") if type(old.get("glassEnabled")) is bool else True,
    }


class BackgroundUnavailable(ValueError):
    def __init__(self, retry_after: int = 5) -> None:
        super().__init__("Background image is temporarily unavailable")
        self.retry_after = max(1, min(60, retry_after))


@dataclass(frozen=True)
class CachedImage:
    path: Path
    mime: str
    fetched_at: float
    stale: bool = False
    retry_after: int = 0


class BackgroundCache:
    # These are global to the panel, not multiplied by IP/window/profile.
    MAX_ATTEMPTS = 12
    WINDOW_SECONDS = 60
    MIN_FETCH_GAP = 1
    MAX_WINDOW_BYTES = 90_000_000

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.lock = threading.Lock()
        self.busy = False
        self.namespace = ""
        self.entries: dict[str, CachedImage] = {}
        self.attempts: deque[float] = deque()
        self.transfers: deque[tuple[float, int]] = deque()
        self.next_fetch = 0.0
        self.failures = 0

    def _select_source(self, namespace: str) -> None:
        if self.namespace == namespace:
            return
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.namespace = namespace
        self.entries = {}
        # Touch only this cache's fixed managed filenames; never user images.
        managed = re.compile(r"[0-9a-f]{20}-(?:portrait|landscape)-[0-9]+\.(?:image|json|tmp)")
        for path in self.directory.iterdir():
            if managed.fullmatch(path.name) and (path.suffix == ".tmp" or not path.name.startswith(namespace + "-")):
                path.unlink(missing_ok=True)
        for profile in PROFILES:
            path = self.directory / f"{namespace}-{profile}.image"
            meta = path.with_suffix(".json")
            try:
                info = json.loads(meta.read_text(encoding="utf-8"))
                fetched = float(info["fetchedAt"])
                if not math.isfinite(fetched) or fetched > time.time() + 5 or not 0 < path.stat().st_size <= MAX_IMAGE_BYTES:
                    continue
                with path.open("rb") as stream:
                    mime = _image_mime(stream.read(16))
                self.entries[profile] = CachedImage(path, mime, fetched)
            except (OSError, ValueError, KeyError, TypeError):
                continue

    def _fallback(self, entry: CachedImage | None, retry: int) -> CachedImage:
        if entry is None:
            raise BackgroundUnavailable(retry)
        return CachedImage(entry.path, entry.mime, entry.fetched_at, True, max(1, retry))

    def get(self, url: str, allowed_hosts: list[str], profile: str = DEFAULT_PROFILE, seconds: int = 0) -> CachedImage:
        if profile not in PROFILES or type(seconds) is not int or seconds not in CACHE_SECONDS:
            raise ValueError("Invalid background profile or cache duration")
        normalized = normalize_https_image_url(url, allowed_hosts)
        namespace = hashlib.sha256(normalized.encode()).hexdigest()[:20]
        with self.lock:
            # Source changes cannot delete a file while a fetch is publishing it.
            if self.busy and self.namespace != namespace:
                raise BackgroundUnavailable(2)
            self._select_source(namespace)
            entry = self.entries.get(profile)
            if entry and seconds and 0 <= time.time() - entry.fetched_at < seconds:
                return entry
            now = time.monotonic()
            while self.attempts and now - self.attempts[0] >= self.WINDOW_SECONDS:
                self.attempts.popleft()
            while self.transfers and now - self.transfers[0][0] >= self.WINDOW_SECONDS:
                self.transfers.popleft()
            retry = max(1, math.ceil(self.next_fetch - now))
            if len(self.attempts) >= self.MAX_ATTEMPTS:
                retry = max(retry, math.ceil(self.WINDOW_SECONDS - (now - self.attempts[0])))
            byte_limited = sum(size for _, size in self.transfers) + MAX_IMAGE_BYTES > self.MAX_WINDOW_BYTES
            if byte_limited:
                retry = max(retry, math.ceil(self.WINDOW_SECONDS - (now - self.transfers[0][0])))
            if self.busy or now < self.next_fetch or len(self.attempts) >= self.MAX_ATTEMPTS or byte_limited:
                return self._fallback(entry, retry)
            self.busy = True
            self.attempts.append(now)
            self.next_fetch = now + self.MIN_FETCH_GAP
        temporary = None
        try:
            width, height = PROFILES[profile]
            target = normalized.replace("{width}", str(width)).replace("{height}", str(height))
            body, mime, _ = fetch_https_image_api(target, allowed_hosts, max_bytes=MAX_IMAGE_BYTES, viewport=(width, height))
            if not 0 < len(body) <= MAX_IMAGE_BYTES or _image_mime(body) != mime:
                raise ValueError("Invalid image body")
            path = self.directory / f"{namespace}-{profile}.image"
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(body)
            temporary.replace(path)
            fetched_at = time.time()
            meta = path.with_suffix(".json")
            try:
                temporary.write_text(json.dumps({"fetchedAt": fetched_at}), encoding="utf-8")
                temporary.replace(meta)
            except OSError:
                # Publication already succeeded. Never label the new bytes
                # with the previous image's MIME/time if metadata storage fails.
                try:
                    meta.unlink(missing_ok=True)
                except OSError:
                    pass
            result = CachedImage(path, mime, fetched_at)
            with self.lock:
                self.entries[profile] = result
                self.transfers.append((time.monotonic(), len(body)))
                self.failures = 0
            return result
        except (ValueError, OSError):
            with self.lock:
                self.failures += 1
                retry = min(30, 2 ** min(self.failures, 5))
                self.next_fetch = max(self.next_fetch, time.monotonic() + retry)
                # Budget failed/partial transfers conservatively at the maximum.
                self.transfers.append((time.monotonic(), MAX_IMAGE_BYTES))
                return self._fallback(entry, retry)
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass
            with self.lock:
                self.busy = False
