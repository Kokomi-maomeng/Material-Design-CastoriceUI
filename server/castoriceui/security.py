from __future__ import annotations

import ipaddress
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


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
    """Validate an image URL that will be loaded by the browser, never fetched by this backend."""
    candidate = value.strip()
    if not candidate or len(candidate) > 2048:
        raise ValueError("Background image URL is empty or too long")
    parsed = urlsplit(candidate)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Background image must use a plain HTTPS URL without credentials, query, or fragment")
    hosts = {str(host).strip().rstrip(".").lower() for host in (allowed_hosts or []) if str(host).strip()}
    if parsed.hostname.rstrip(".").lower() not in hosts:
        raise ValueError("Background image host is not allowlisted by the server configuration")
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", "", ""))


def _validated_background_candidate(root_path: Path, candidate: Path, max_bytes: int) -> tuple[Path, str]:
    resolved_candidate = candidate.resolve()
    if resolved_candidate.parent != root_path or resolved_candidate.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("Background image is outside the allowed image directory")
    if not resolved_candidate.is_file() or not 0 < resolved_candidate.stat().st_size <= max_bytes:
        raise ValueError("Background image is unavailable or exceeds 5 MB")
    with resolved_candidate.open("rb") as image:
        header = image.read(16)
    mime = ""
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif header.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        mime = "image/webp"
    if not mime:
        raise ValueError("Background image content is not PNG, JPEG, or WebP")
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
