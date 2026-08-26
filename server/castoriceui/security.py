from __future__ import annotations

import http.client
import ipaddress
import json
import re
import socket
import ssl
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from . import __version__


_HOST_LABEL = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")
_INTERFACE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,14}$")


def normalize_loopback_endpoint(value: str) -> str:
    """Return a canonical HTTP endpoint that cannot leave the local host."""
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Endpoint must be an http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Endpoint must not contain credentials, a query, or a fragment")
    host = parsed.hostname.rstrip(".").lower()
    if host != "localhost":
        try:
            address = ipaddress.ip_address(host)
        except ValueError as error:
            raise ValueError("Management endpoint must use localhost or a loopback IP address") from error
        if not address.is_loopback:
            raise ValueError("Management endpoint must use localhost or a loopback IP address")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def normalize_https_base_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Subscription base URL must use HTTPS")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Subscription base URL must not contain credentials, a query, or a fragment")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def normalize_subscription_url(value: str) -> str:
    """Validate a protected subscription URL without exposing or rewriting its token."""
    candidate = value.strip()
    if not candidate or len(candidate) > 2048:
        raise ValueError("Subscription URL is empty or too long")
    parsed = urlsplit(candidate)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Subscription URL must use HTTPS without credentials or a fragment")
    try:
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError
    except ValueError as error:
        raise ValueError("Subscription URL contains an invalid port") from error
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", parsed.query, ""))


def probe_subscription_url(value: str, max_bytes: int = 256 * 1024) -> None:
    """Perform a bounded, no-redirect, public-network HTTPS subscription probe."""
    normalized = normalize_subscription_url(value)
    try:
        status, headers, body = _public_https_get(
            normalized,
            {
                "Accept": "text/plain,application/octet-stream,application/yaml,application/json;q=0.8,*/*;q=0.5",
                "User-Agent": f"CastoriceUI/{__version__} subscription-check",
            },
            max_bytes,
        )
    except (TimeoutError, OSError, ssl.SSLError, http.client.HTTPException) as error:
        raise ValueError("Subscription publisher is unreachable") from error
    if not 200 <= status < 300:
        raise ValueError(f"Subscription publisher returned HTTP {status}")
    declared = headers.get("Content-Length")
    if declared:
        try:
            declared_length = int(declared)
        except (TypeError, ValueError):
            declared_length = 0
        if declared_length > max_bytes:
            raise ValueError("Subscription response exceeds 256 KiB")
    if not body:
        raise ValueError("Subscription publisher returned an empty response")
    if len(body) > max_bytes:
        raise ValueError("Subscription response exceeds 256 KiB")


def validate_probe_target(value: str) -> tuple[str, int]:
    candidate = value.strip()
    if not candidate or len(candidate) > 253 or candidate.startswith("-"):
        raise ValueError("Network targets must be valid IP addresses or host names")
    try:
        address = ipaddress.ip_address(candidate)
        return str(address), address.version
    except ValueError:
        try:
            ascii_host = candidate.rstrip(".").encode("idna").decode("ascii")
        except UnicodeError as error:
            raise ValueError("Network targets must be valid IP addresses or host names") from error
        if not ascii_host or any(not _HOST_LABEL.fullmatch(label) for label in ascii_host.split(".")):
            raise ValueError("Network targets must be valid IP addresses or host names")
        return ascii_host.lower(), 4


def validate_interface_name(value: str) -> str:
    candidate = value.strip()
    if not _INTERFACE_NAME.fullmatch(candidate):
        raise ValueError("Network interface name is invalid")
    return candidate


def normalize_https_image_url(value: str, allowed_hosts: list[str] | None = None) -> str:
    """Validate a public HTTPS image/API URL fetched through the same-origin backend."""
    candidate = value.strip()
    if not candidate or len(candidate) > 2048:
        raise ValueError("Background image URL is empty or too long")
    parsed = urlsplit(candidate)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Background image API must use HTTPS without credentials or a fragment")
    hosts = {str(host).strip().rstrip(".").lower() for host in (allowed_hosts or []) if str(host).strip()}
    if hosts and parsed.hostname.rstrip(".").lower() not in hosts:
        raise ValueError("Background image host is not allowlisted by the server configuration")
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", parsed.query, ""))


def _require_public_host(host: str, port: int = 443) -> list[str]:
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            addresses = list(dict.fromkeys(ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
        except (OSError, ValueError) as error:
            raise ValueError("Background image host cannot be resolved") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Background image host must resolve only to public IP addresses")
    return [str(address) for address in addresses]


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Use one pre-validated address while retaining Host and TLS SNI."""

    def __init__(self, host: str, port: int, address: str, timeout: float) -> None:
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self._pinned_address = address

    def connect(self) -> None:
        raw_socket = socket.create_connection(
            (self._pinned_address, self.port),
            self.timeout,
            self.source_address,
        )
        try:
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)
        except Exception:
            raw_socket.close()
            raise


def _public_https_get(value: str, headers: dict[str, str], max_bytes: int, timeout: float = 8) -> tuple[int, http.client.HTTPMessage, bytes]:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Public fetch URL must use HTTPS")
    port = parsed.port or 443
    addresses = _require_public_host(str(parsed.hostname), port)
    target = urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    last_error: Exception | None = None
    for address in addresses:
        connection = _PinnedHTTPSConnection(str(parsed.hostname), port, address, timeout)
        try:
            connection.request("GET", target, headers=headers)
            response = connection.getresponse()
            return response.status, response.headers, response.read(max_bytes + 1)
        except (TimeoutError, OSError, ssl.SSLError, http.client.HTTPException) as error:
            last_error = error
        finally:
            connection.close()
    if last_error is not None:
        raise last_error
    raise OSError("No validated public address is available")


def _image_mime(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("Background API did not return PNG, JPEG, or WebP content")


def fetch_https_image_api(value: str, allowed_hosts: list[str] | None = None, max_bytes: int = 5 * 1024 * 1024) -> tuple[bytes, str, str]:
    """Fetch a bounded public image response, redirect, or small JSON object containing an image URL."""
    current = normalize_https_image_url(value, allowed_hosts)
    for _ in range(5):
        try:
            status, headers, body = _public_https_get(
                current,
                {"Accept": "image/avif,image/webp,image/png,image/jpeg,application/json;q=0.8", "User-Agent": f"CastoriceUI/{__version__}"},
                max_bytes,
            )
        except (TimeoutError, OSError, ssl.SSLError, http.client.HTTPException) as error:
            raise ValueError("Background image API is unreachable") from error
        if status in {301, 302, 303, 307, 308} and headers.get("Location"):
            from urllib.parse import urljoin
            current = normalize_https_image_url(urljoin(current, headers["Location"]), allowed_hosts)
            continue
        if not 200 <= status < 300:
            raise ValueError(f"Background API returned HTTP {status}")
        length = headers.get("Content-Length")
        if length:
            try:
                declared_length = int(length)
            except (TypeError, ValueError):
                declared_length = 0
            if declared_length > max_bytes:
                raise ValueError("Background image exceeds 5 MB")
        if not body or len(body) > max_bytes:
            raise ValueError("Background image is empty or exceeds 5 MB")
        content_type = headers.get_content_type().lower()
        if content_type == "application/json":
            if len(body) > 64 * 1024:
                raise ValueError("Background API JSON response exceeds 64 KiB")
            try:
                payload = json.loads(body)
                candidate = next(str(payload[key]) for key in ("url", "image", "imageUrl", "image_url") if isinstance(payload, dict) and payload.get(key))
            except (json.JSONDecodeError, StopIteration, TypeError, ValueError) as error:
                raise ValueError("Background API JSON must contain url, image, imageUrl, or image_url") from error
            current = normalize_https_image_url(candidate, allowed_hosts)
            continue
        return body, _image_mime(body), current
    raise ValueError("Background image API redirected too many times")


def _validated_background_candidate(root_path: Path, candidate: Path, max_bytes: int) -> tuple[Path, str]:
    resolved_candidate = candidate.resolve()
    if resolved_candidate.parent != root_path or resolved_candidate.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Background image is outside the allowed image directory")
    if not resolved_candidate.is_file() or not 0 < resolved_candidate.stat().st_size <= max_bytes:
        raise ValueError("Background image is unavailable or exceeds 5 MB")
    with resolved_candidate.open("rb") as image:
        header = image.read(16)
    mime = _image_mime(header)
    return resolved_candidate, mime


def safe_background_image(root: str | Path, filename: str, max_bytes: int = 5 * 1024 * 1024) -> tuple[Path, str]:
    if not filename or filename != Path(filename).name or len(filename) > 180:
        raise ValueError("Background image filename is invalid")
    root_path = Path(root).resolve()
    if not root_path.is_dir():
        raise ValueError("Background image directory is unavailable")
    # Compare the request value with names enumerated by the server. Never join
    # caller-controlled text into a filesystem path.
    candidate = next((entry for entry in root_path.iterdir() if entry.name == filename), None)
    if candidate is None:
        raise ValueError("Background image is unavailable or exceeds 5 MB")
    return _validated_background_candidate(root_path, candidate, max_bytes)


def list_background_images(root: str | Path) -> list[str]:
    root_path = Path(root).resolve()
    if not root_path.is_dir():
        return []
    result: list[str] = []
    for candidate in sorted(root_path.iterdir(), key=lambda item: item.name.lower()):
        try:
            _validated_background_candidate(root_path, candidate, 5 * 1024 * 1024)
        except (OSError, ValueError):
            continue
        result.append(candidate.name)
    return result[:100]
