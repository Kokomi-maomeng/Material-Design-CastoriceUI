from __future__ import annotations

import http.client
import base64
import binascii
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


_SUBSCRIPTION_SCHEMES = {"ss", "shadowsocks", "vmess", "vless", "trojan", "hysteria2", "hy2", "tuic", "socks", "socks5", "anytls"}


class SubscriptionProbeError(ValueError):
    """Safe staged result: HTTPS reachability is distinct from format parsing."""

    def __init__(self, message: str, *, reachable: bool, parseable: bool = False) -> None:
        super().__init__(message)
        self.reachable = reachable
        self.parseable = parseable


def _valid_node_host(value: object) -> bool:
    candidate = str(value or "").strip().rstrip(".")
    if not candidate or len(candidate) > 253 or any(character.isspace() for character in candidate):
        return False
    try:
        ipaddress.ip_address(candidate)
        return True
    except ValueError:
        return all(_HOST_LABEL.fullmatch(label) for label in candidate.split("."))


def _valid_node_port(value: object) -> bool:
    try:
        return not isinstance(value, bool) and 1 <= int(str(value)) <= 65535
    except (TypeError, ValueError):
        return False


def _node_has_credentials(protocol: str, node: dict[str, object]) -> bool:
    if protocol in {"vless", "vmess"}:
        return bool(str(node.get("uuid") or node.get("id") or "").strip())
    if protocol in {"trojan", "hysteria2", "hy2", "anytls"}:
        return bool(str(node.get("password") or node.get("auth") or node.get("auth_str") or "").strip())
    if protocol == "tuic":
        return bool(str(node.get("uuid") or "").strip() and str(node.get("password") or "").strip())
    if protocol in {"ss", "shadowsocks"}:
        return bool(str(node.get("password") or "").strip() and str(node.get("cipher") or node.get("method") or "").strip())
    if protocol in {"socks", "socks5"}:
        return bool(str(node.get("username") or "").strip() and str(node.get("password") or "").strip())
    return False


def _valid_structured_node(node: object, *, singbox: bool = False) -> bool:
    if not isinstance(node, dict):
        return False
    protocol = str(node.get("type", "")).casefold()
    if protocol not in _SUBSCRIPTION_SCHEMES:
        return False
    port_key = "server_port" if singbox else "port"
    return (
        _valid_node_host(node.get("server"))
        and _valid_node_port(node.get(port_key))
        and _node_has_credentials(protocol, node)
    )


def _decode_base64_text(value: str) -> str:
    return base64.b64decode(value + "=" * (-len(value) % 4), validate=True).decode("utf-8")


def _valid_proxy_uri(candidate: str) -> bool:
    scheme, separator, remainder = candidate.partition("://")
    protocol = scheme.casefold()
    if separator != "://" or protocol not in _SUBSCRIPTION_SCHEMES:
        return False
    if protocol == "vmess":
        try:
            raw = remainder.split("#", 1)[0].split("?", 1)[0]
            node = json.loads(_decode_base64_text(raw))
        except (binascii.Error, UnicodeError, json.JSONDecodeError, ValueError):
            return False
        return isinstance(node, dict) and _valid_node_host(node.get("add")) and _valid_node_port(node.get("port")) and bool(str(node.get("id", "")).strip()) and bool(str(node.get("net", "")).strip())
    parsed = urlsplit(candidate)
    if not _valid_node_host(parsed.hostname):
        if protocol not in {"ss", "shadowsocks"}:
            return False
        try:
            parsed = urlsplit(f"ss://{_decode_base64_text(remainder.split('#', 1)[0])}")
        except (binascii.Error, UnicodeError, ValueError):
            return False
    try:
        port = parsed.port
    except ValueError:
        return False
    if not _valid_node_host(parsed.hostname) or not _valid_node_port(port) or not parsed.username:
        return False
    username = parsed.username
    password = parsed.password
    if protocol in {"ss", "shadowsocks"} and not password:
        try:
            username, password = _decode_base64_text(username).split(":", 1)
        except (binascii.Error, UnicodeError, ValueError):
            return False
    if protocol in {"ss", "shadowsocks", "tuic", "socks", "socks5"}:
        return bool(username and password)
    return bool(username)


def _parse_subscription(body: bytes, content_type: str, depth: int = 0) -> dict[str, int | str]:
    if depth > 1:
        raise ValueError("Subscription response contains no valid proxy node")
    text = body.decode("utf-8-sig", errors="strict").strip()
    lowered = text[:512].casefold()
    if "html" in content_type or lowered.startswith(("<!doctype html", "<html", "<head", "<body")):
        raise ValueError("Subscription publisher returned HTML instead of a subscription")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None
    if isinstance(payload, dict):
        if isinstance(payload.get("proxies"), list):
            valid = [item for item in payload["proxies"] if isinstance(item, dict) and item.get("name") and _valid_structured_node(item)]
            if valid:
                return {"format": "clash-json", "nodeCount": len(valid)}
        if isinstance(payload.get("outbounds"), list):
            valid = [item for item in payload["outbounds"] if _valid_structured_node(item, singbox=True)]
            if valid:
                return {"format": "sing-box-json", "nodeCount": len(valid)}
        raise ValueError("Subscription response contains no valid proxy node")
    uri_count = 0
    for line in text.splitlines():
        candidate = line.strip()
        if _valid_proxy_uri(candidate):
            uri_count += 1
    if uri_count:
        return {"format": "uri-list", "nodeCount": uri_count}
    # Conservative Clash YAML recognition: require proxies plus per-node name/server/port fields.
    if re.search(r"(?m)^proxies\s*:\s*$", text):
        blocks = re.split(r"(?m)^\s*-\s+", text)[1:]
        valid = []
        for block in blocks:
            fields = {match.group(1): match.group(2).strip().strip("'\"") for match in re.finditer(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$", block)}
            if fields.get("name") and _valid_structured_node(fields):
                valid.append(fields)
        if valid:
            return {"format": "clash-yaml", "nodeCount": len(valid)}
    try:
        compact = "".join(text.split())
        decoded = base64.b64decode(compact + "=" * (-len(compact) % 4), validate=True)
        if decoded and decoded != body:
            parsed = _parse_subscription(decoded, "text/plain", depth + 1)
            return {"format": f"base64-{parsed['format']}", "nodeCount": int(parsed["nodeCount"])}
    except (binascii.Error, UnicodeError, ValueError):
        pass
    raise ValueError("Subscription response contains no valid proxy node")


def probe_subscription_url(value: str, max_bytes: int = 256 * 1024, timeout: float = 8) -> dict[str, int | str]:
    """Perform a bounded, no-redirect, public-network HTTPS subscription probe."""
    normalized = normalize_subscription_url(value)
    try:
        status, headers, body = _public_https_get(
            normalized,
            {
                "Accept": "text/plain,application/octet-stream,application/yaml,application/json;q=0.8,*/*;q=0.5",
                "User-Agent": f"CastoriceUI/{__version__} subscription-check",
            },
            max_bytes, timeout,
        )
    except (TimeoutError, OSError, ssl.SSLError, http.client.HTTPException) as error:
        raise SubscriptionProbeError("Subscription publisher is unreachable", reachable=False) from error
    if not 200 <= status < 300:
        raise SubscriptionProbeError("Subscription publisher returned an unsuccessful HTTPS response", reachable=True)
    declared = headers.get("Content-Length")
    if declared:
        try:
            declared_length = int(declared)
        except (TypeError, ValueError):
            declared_length = 0
        if declared_length > max_bytes:
            raise SubscriptionProbeError("Subscription response exceeds 256 KiB", reachable=True)
    if not body:
        raise SubscriptionProbeError("Subscription publisher returned an empty response", reachable=True)
    if len(body) > max_bytes:
        raise SubscriptionProbeError("Subscription response exceeds 256 KiB", reachable=True)
    try:
        return _parse_subscription(body, headers.get_content_type().lower())
    except ValueError as error:
        raise SubscriptionProbeError(str(error), reachable=True) from error


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
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        super().__init__(host, port=port, timeout=timeout, context=context)
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
