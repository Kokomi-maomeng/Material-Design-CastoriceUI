#!/usr/bin/env python3
"""Restricted certificate delivery with verified hot reload; never restart cores.

Root-owned config supplies fixed paths and optional local HY2 client settings.
The caller can supply only two PEM files and check/install, never commands.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid


def command(args, timeout=5, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise ValueError("certificate_command_failed")
    return result.stdout


def validate(cert: Path, key: Path, hostname: str, minimum=604800) -> str:
    if minimum is not None:
        command(["openssl", "x509", "-in", str(cert), "-noout", "-checkend", str(minimum)])
    decoded = ssl._ssl._test_decode_cert(str(cert))
    if hostname not in {value for kind, value in decoded.get("subjectAltName", []) if kind == "DNS"}:
        raise ValueError("certificate_san_mismatch")
    public = command(["openssl", "x509", "-in", str(cert), "-pubkey", "-noout"])
    public = command(["openssl", "pkey", "-pubin", "-outform", "DER"], data=public)
    private = command(["openssl", "pkey", "-in", str(key), "-pubout", "-outform", "DER"])
    if public != private:
        raise ValueError("certificate_key_mismatch")
    der = command(["openssl", "x509", "-in", str(cert), "-outform", "DER"])
    return hashlib.sha256(der).hexdigest()


def unpack(data: bytes, directory: Path) -> tuple[Path, Path]:
    if len(data) > 524288:
        raise ValueError("certificate_input_too_large")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        entries = archive.getmembers()
        if len(entries) != 2 or {item.name for item in entries} != {"fullchain.pem", "privkey.pem"}:
            raise ValueError("certificate_archive_members_invalid")
        for item in entries:
            if not item.isfile() or not 0 < item.size <= 131072:
                raise ValueError("certificate_archive_member_invalid")
            destination = directory / item.name
            destination.write_bytes(archive.extractfile(item).read())
            destination.chmod(0o600)
    return directory / "fullchain.pem", directory / "privkey.pem"


def replace(source: Path, destination: Path) -> None:
    """Same filesystem rename; preserve each destination's restricted ownership."""
    stat = destination.stat()
    fd, temporary = tempfile.mkstemp(prefix=".certificate-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(source.read_bytes())
            handle.flush()
            os.fchmod(handle.fileno(), stat.st_mode & 0o777)
            os.fchown(handle.fileno(), stat.st_uid, stat.st_gid)
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)


def tls_probe(config: dict, expected: str) -> bool:
    context = ssl.create_default_context(cafile=config.get("caFile"))
    with socket.create_connection((config.get("tlsAddress", "127.0.0.1"), int(config.get("tlsPort", 443))), timeout=2) as stream:
        with context.wrap_socket(stream, server_hostname=config["hostname"]) as tls:
            return hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest() == expected


def hy2_probe(config: dict, expected: str) -> bool:
    client = config.get("hy2Client")
    if not isinstance(client, dict):
        return False  # QUIC evidence is mandatory for the dual-protocol receiver.
    with tempfile.TemporaryDirectory(prefix="hy2-certificate-", dir="/run") as folder:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        settings = json.loads(json.dumps(client))
        settings.setdefault("tls", {}).update(pinSHA256=expected, insecure=False)
        settings["socks5"] = {"listen": f"127.0.0.1:{port}"}
        path = Path(folder) / "client.json"
        path.write_text(json.dumps(settings))
        path.chmod(0o600)
        process = subprocess.Popen([config.get("hy2Binary", "/usr/local/bin/hysteria"), "client", "-c", str(path), "--disable-update-check"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and process.poll() is None:
                probe = subprocess.run(["curl", "--silent", "--max-time", "2", "--proxy", f"socks5h://127.0.0.1:{port}", "--output", "/dev/null", "--write-out", "%{http_code}", config.get("testUrl", "https://example.com")], capture_output=True, timeout=3, check=False)
                if probe.returncode == 0 and probe.stdout[:1] in {b"2", b"3"}:
                    return True
                time.sleep(0.2)
            return False
        finally:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)


def anytls_probe(config: dict) -> bool:
    outbound = config.get("anytlsClient")
    if not isinstance(outbound, dict):
        return False
    with tempfile.TemporaryDirectory(prefix="anytls-certificate-", dir="/run") as folder:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        settings = {"log": {"level": "error"}, "inbounds": [{"type": "socks", "listen": "127.0.0.1", "listen_port": port}], "outbounds": [outbound]}
        path = Path(folder) / "client.json"
        path.write_text(json.dumps(settings))
        path.chmod(0o600)
        process = subprocess.Popen([config.get("singboxBinary", "/usr/bin/sing-box"), "run", "-c", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline and process.poll() is None:
                result = subprocess.run(["curl", "--silent", "--max-time", "2", "--proxy", f"socks5h://127.0.0.1:{port}", "--output", "/dev/null", "--write-out", "%{http_code}", config.get("testUrl", "https://example.com")], capture_output=True, timeout=3, check=False)
                if result.returncode == 0 and result.stdout[:1] in {b"2", b"3"}:
                    return True
                time.sleep(.2)
            return False
        finally:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)


def activated(config: dict, expected: str) -> bool:
    for _ in range(3):
        try:
            if tls_probe(config, expected) and anytls_probe(config) and hy2_probe(config, expected):
                return True
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        time.sleep(0.5)
    return False


def install(config: dict, cert: Path, key: Path, record: Path) -> dict:
    expected = validate(cert, key, config["hostname"])
    cert_dst, key_dst = Path(config["certificatePath"]), Path(config["keyPath"])
    changed = cert.read_bytes() != cert_dst.read_bytes() or key.read_bytes() != key_dst.read_bytes()
    transaction = uuid.uuid4().hex
    state = {"id": transaction, "startedAt": time.time(), "expiresAt": time.time() + 60, "state": "activating", "certificateSha256": expected}
    def publish():
        temporary = record.with_suffix(".next")
        temporary.write_text(json.dumps(state))
        temporary.chmod(0o644)
        os.replace(temporary, record)
    publish()
    backup = Path(config.get("backupDirectory", "/root/codex-backups")) / ("certificate-" + transaction)
    try:
        backup.mkdir(parents=True, mode=0o700)
        shutil.copy2(cert_dst, backup / "fullchain.pem")
        shutil.copy2(key_dst, backup / "privkey.pem")
        old_sha = validate(backup / "fullchain.pem", backup / "privkey.pem", config["hostname"], minimum=None)
    except (OSError, ValueError, subprocess.SubprocessError):
        state.update(state="preparation_failed", endedAt=time.time(), reason="backup_or_old_material_invalid")
        publish()
        raise ValueError("certificate_preparation_failed") from None
    try:
        if changed:
            replace(cert, cert_dst)
            replace(key, key_dst)
        if not activated(config, expected):
            raise ValueError("certificate_activation_failed")
        if changed and config.get("reloadNginx", True):
            command(["nginx", "-t"])
            command(["systemctl", "reload", "nginx"])
        state.update(state="verified", endedAt=time.time(), changed=changed)
        publish()
        return state
    except (OSError, ValueError, subprocess.SubprocessError):
        restored = False
        try:
            if changed:
                replace(backup / "fullchain.pem", cert_dst)
                replace(backup / "privkey.pem", key_dst)
            restored = activated(config, old_sha)
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
        state.update(state="rolled_back" if restored else "activation_failed", endedAt=time.time(), reason="activation_or_reload_failed", oldCertificateSha256=old_sha)
        publish()
        raise ValueError("certificate_activation_failed") from None


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "install"))
    parser.add_argument("--config", default="/etc/castoriceui/certificate-receiver.json")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    root = Path("/run/castoriceui")
    root.mkdir(mode=0o755, exist_ok=True)
    with (root / "certificate-receiver.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix="certificate-incoming-", dir="/run") as folder:
            cert, key = unpack(sys.stdin.buffer.read(524289), Path(folder))
            if args.mode == "check":
                validate(cert, key, config["hostname"])
                print("CERTIFICATE_CHECK_OK")
            else:
                state = install(config, cert, key, root / "certificate-maintenance.json")
                print("CERTIFICATE_INSTALL_OK" if state["changed"] else "CERTIFICATE_UNCHANGED")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"event": "certificate_delivery_failed", "exceptionType": type(error).__name__}), file=sys.stderr, flush=True)
        raise SystemExit(1)
