#!/usr/bin/env python3
"""Small authenticated business probes using an isolated existing Mihomo binary.

Run once per minute from the actual access network. Configuration is private:
panelUrl, secret, agentId, clientBinary, testUrl, proxies (anytls/hysteria2).
The client never changes TUN, routing, system proxy or an existing client.
"""
import argparse
import hashlib
import hmac
import http.client
import json
from pathlib import Path
import secrets
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import HTTPSHandler, ProxyHandler, Request, build_opener


def bind_probe_socket(stream, config: dict) -> None:
    if sys.platform == "win32" and config.get("interfaceIndex"):
        # Winsock IP_UNICAST_IF requires the index in network byte order.
        stream.setsockopt(socket.IPPROTO_IP, getattr(socket, "IP_UNICAST_IF", 31), struct.pack("!I", int(config["interfaceIndex"])))


def resolve_direct(host: str, config: dict) -> str:
    try:
        socket.inet_aton(host)
        return host
    except OSError:
        pass
    resolver = config.get("resolverAddress")
    if not resolver:
        return socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    labels = host.encode("idna").split(b".")
    if any(not 1 <= len(label) <= 63 for label in labels):
        raise ValueError("invalid_hostname")
    query_id = secrets.randbelow(65536)
    question = b"".join(bytes([len(label)]) + label for label in labels) + b"\x00\x00\x01\x00\x01"
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as stream:
        bind_probe_socket(stream, config)
        stream.settimeout(3)
        stream.connect((resolver, 53))
        stream.send(struct.pack("!6H", query_id, 0x100, 1, 0, 0, 0) + question)
        response = stream.recv(4096)
    if len(response) < 12 or response[:2] != struct.pack("!H", query_id) or response[3] & 15 or response[12:12+len(question)] != question:
        raise ValueError("observer_dns_failed")
    count = struct.unpack("!H", response[6:8])[0]
    offset = 12 + len(question)
    for _ in range(min(count, 32)):
        while offset < len(response) and response[offset]:
            if response[offset] & 0xC0 == 0xC0:
                offset += 2
                break
            offset += 1 + response[offset]
        else:
            offset += 1
        if offset + 10 > len(response):
            break
        kind, group, _, length = struct.unpack("!HHIH", response[offset:offset+10])
        offset += 10
        if kind == 1 and group == 1 and length == 4 and offset + 4 <= len(response):
            return socket.inet_ntoa(response[offset:offset+4])
        offset += length
    raise ValueError("observer_dns_answer_unavailable")


def direct_socket(host: str, port: int, config: dict, timeout: float = 5):
    if not config.get("interfaceIndex"):
        return socket.create_connection((host, port), timeout=timeout)
    address = resolve_direct(host, config)
    stream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        bind_probe_socket(stream, config)
        stream.settimeout(timeout)
        stream.connect((address, port))
        return stream
    except BaseException:
        stream.close()
        raise


def direct_fetch(config: dict, url: str, payload: bytes | None = None, headers: dict | None = None) -> bytes:
    class BoundHTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            self.sock = direct_socket(self.host, self.port, config)
            self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)
    class BoundHTTPSHandler(HTTPSHandler):
        def https_open(self, request):
            context = ssl.create_default_context()
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            return self.do_open(BoundHTTPSConnection, request, context=context)
    with build_opener(ProxyHandler({}), BoundHTTPSHandler()).open(Request(url, data=payload, headers=headers or {}), timeout=5) as response:
        if not 200 <= response.status < 400:
            raise ValueError("unexpected_response")
        return response.read(4096)


def read_exact(stream, count: int) -> bytes:
    value = b""
    while len(value) < count:
        part = stream.recv(count - len(value))
        if not part:
            raise ValueError("connection_closed")
        value += part
    return value


def open_tunnel(port: int, target: str, evidence: dict | None = None):
    parsed = urlparse(target)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("https_test_target_required")
    stream = socket.create_connection(("127.0.0.1", port), timeout=4)
    try:
        stream.sendall(b"\x05\x01\x00")
        if read_exact(stream, 2) != b"\x05\x00":
            raise ValueError("local_client_unavailable")
        host = parsed.hostname.encode("idna")
        stream.sendall(b"\x05\x01\x00\x03" + bytes([len(host)]) + host + struct.pack("!H", parsed.port or 443))
        response = read_exact(stream, 4)
        if response[1] != 0:
            raise ValueError("tunnel_rejected")
        read_exact(stream, 6 if response[3] == 1 else 18 if response[3] == 4 else read_exact(stream, 1)[0] + 2)
        if evidence is not None:
            evidence["failedStage"] = "forwarding"
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        return context.wrap_socket(stream, server_hostname=parsed.hostname)
    except BaseException:
        stream.close()
        raise


def request_once(stream, target: str) -> None:
    parsed = urlparse(target)
    path = parsed.path or "/"
    stream.sendall(f"HEAD {path} HTTP/1.1\r\nHost: {parsed.hostname}\r\nConnection: keep-alive\r\nUser-Agent: CastoriceUI-Monitor/4.7\r\n\r\n".encode("ascii"))
    header = b""
    while b"\r\n\r\n" not in header and len(header) < 8192:
        header += read_exact(stream, 1)
    status = header.split(b" ", 2)[1] if b" " in header else b""
    if not status[:1] in {b"2", b"3"}:
        raise ValueError("forward_response_failed")


def failure_stage(log: bytes, protocol: str, fallback: str) -> str:
    """Return only a category; client output can contain protected endpoints."""
    value = log[-65536:].decode("utf-8", errors="replace").casefold()
    if any(marker in value for marker in ("authentication failed", "authentication error", "auth error", "auth failed", "invalid password", "status code: 403", "status code: 404")):
        return "authentication"
    if any(marker in value for marker in ("certificate", "tls handshake", "x509")):
        return "tls" if protocol == "anytls" else "quic"
    if protocol == "hysteria2" and any(marker in value for marker in ("no recent network activity", "handshake timeout", "quic")):
        return "quic"
    if any(marker in value for marker in ("connection refused", "network is unreachable", "connect to destination", "remote dial", "proxy error")):
        return "forwarding"
    return fallback


def probe(config: dict, protocol: str, proxy: dict) -> dict:
    started = time.monotonic()
    result = {"status": "failed", "failedStage": "transport"}
    if proxy.get("type") != ("anytls" if protocol == "anytls" else "hysteria2") or proxy.get("skip-cert-verify") is True:
        return {"status": "unavailable", "failedStage": "observer", "durationMs": 0}
    try:
        if protocol == "anytls":
            with direct_socket(proxy["server"], int(proxy["port"]), config, timeout=3) as tcp:
                result["failedStage"] = "tls"
                context = ssl.create_default_context()
                context.minimum_version = ssl.TLSVersion.TLSv1_2
                with context.wrap_socket(tcp, server_hostname=proxy.get("sni") or proxy["server"]) as tls:
                    result["certificateSha256"] = hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest()
        result["failedStage"] = "transport"
        with tempfile.TemporaryDirectory(prefix="castorice-monitor-") as directory:
            folder = Path(directory)
            with socket.socket() as local:
                local.bind(("127.0.0.1", 0))
                port = local.getsockname()[1]
            settings = {"mixed-port": port, "bind-address": "127.0.0.1", "allow-lan": False, "mode": "rule", "log-level": "warning", "ipv6": True, "tun": {"enable": False}, "proxies": [{**proxy, "name": "monitor"}], "rules": ["MATCH,monitor"]}
            if config.get("interfaceName"):
                settings["interface-name"] = config["interfaceName"]
            path = folder / "client.json"
            path.write_text(json.dumps(settings), encoding="utf-8")
            path.chmod(0o600)
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            log_path = folder / "client.log"
            log = log_path.open("wb")
            log_path.chmod(0o600)
            try:
                process = subprocess.Popen([config["clientBinary"], "-d", str(folder), "-f", str(path)], stdout=log, stderr=log, creationflags=flags)
            except OSError:
                log.close()
                result["failedStage"] = "observer"
                raise
            try:
                deadline = time.monotonic() + 6
                while True:
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=.2):
                            break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            result["failedStage"] = "observer"
                            raise ValueError("client_not_ready")
                        time.sleep(.1)
                with open_tunnel(port, config["testUrl"], result) as stream:
                    result["failedStage"] = "forwarding"
                    request_once(stream, config["testUrl"])
                    time.sleep(.2)
                    # Same established proxy and HTTPS connection, followed by a new one.
                    request_once(stream, config["testUrl"])
                    result["existingConnection"] = True
                with open_tunnel(port, config["testUrl"], result) as stream:
                    request_once(stream, config["testUrl"])
                result.update(status="passed", failedStage="")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=3)
                log.close()
                if result["status"] != "passed":
                    result["failedStage"] = failure_stage(log_path.read_bytes(), protocol, result["failedStage"])
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        if result["failedStage"] == "observer":
            result["status"] = "unavailable"
    result["durationMs"] = min(60000, round((time.monotonic() - started) * 1000))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if urlparse(config["panelUrl"]).scheme != "https" or len(config["secret"]) < 32:
        raise ValueError("protected_https_configuration_required")
    try:
        direct_fetch(config, config["testUrl"])
        healthy = True
    except (OSError, ValueError):
        healthy = False
    results = {key: probe(config, key, value) if healthy else {"status": "unavailable", "failedStage": "observer", "durationMs": 0} for key, value in config["proxies"].items() if key in {"anytls", "hysteria2"}}
    payload = {"agentId": config["agentId"], "nonce": secrets.token_urlsafe(24), "observedAt": int(time.time()), "agentHealthy": healthy, "protocols": results}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()
    signature = hmac.new(config["secret"].encode(), encoded, hashlib.sha256).hexdigest()
    acknowledgement = json.loads(direct_fetch(config, config["panelUrl"].rstrip("/") + "/api/v2/monitoring/probe", encoded, {"Content-Type": "application/json", "X-Castorice-Signature": signature}))
    if acknowledgement.get("ok") is not True:
        raise ValueError("probe_report_rejected")
    print(json.dumps({"reported": True, "agentHealthy": healthy, "protocols": results}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"reported": False, "exceptionType": type(error).__name__}))
        raise SystemExit(1)
