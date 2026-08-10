from __future__ import annotations

import ipaddress
import re
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
