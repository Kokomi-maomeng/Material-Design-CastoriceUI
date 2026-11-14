#!/usr/bin/env python3
"""Create initial panel identity and files once, or report a read-only plan."""
import argparse
import grp
import importlib.util
import json
import os
import pwd
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = Path("/etc/castoriceui/config.json")
STATE = Path("/var/lib/castoriceui")
sys.path.insert(0, str(ROOT / "server"))
from castoriceui.host_permissions import check_config, check_state


def plan() -> dict:
    needed = ("nginx", "python3", "systemctl", "openssl", "ip", "ping", "getent", "groupadd", "useradd", "usermod", "install")
    missing = [name for name in needed if not shutil.which(name)]
    if importlib.util.find_spec("yaml") is None:
        missing.append("python3-yaml")
    return {
        "missingDependencies": missing, "config": "verify-existing" if os.path.lexists(CONFIG) else "create-from-example",
        "requires": ["root", "panel hostname and certificate", "reviewed and enabled Nginx TLS site"],
    }


def prepare(result: dict) -> None:
    if os.geteuid() != 0:
        raise PermissionError("Root privileges required")
    run = lambda *args: subprocess.run(args, check=True, capture_output=True, timeout=20)
    try:
        account = pwd.getpwnam("castoriceui")
    except KeyError:
        run("useradd", "--system", "--user-group", "--home-dir", str(STATE), "--shell", "/usr/sbin/nologin", "castoriceui")
        account = pwd.getpwnam("castoriceui")
    if account.pw_uid == 0 or account.pw_gid != grp.getgrnam("castoriceui").gr_gid:
        raise ValueError("Unexpected castoriceui account or group")
    run("groupadd", "--system", "--force", "proxycert")
    if "castoriceui" not in grp.getgrnam("proxycert").gr_mem:
        run("usermod", "--append", "--groups", "proxycert", "castoriceui")
    if not os.path.lexists(CONFIG.parent):
        run("install", "-d", "-m", "0750", "-o", "root", "-g", "castoriceui", str(CONFIG.parent))
    for directory in (STATE, STATE / "login-backgrounds"):
        if not os.path.lexists(directory):
            if directory.parent == STATE:
                check_state(directory, account.pw_uid, account.pw_gid, directory=True, optional=True)
            run("install", "-d", "-m", "0700", "-o", "castoriceui", "-g", "castoriceui", str(directory))
    if not os.path.lexists(CONFIG):
        if CONFIG.parent.is_symlink() or CONFIG.parent.stat().st_uid != 0 or CONFIG.parent.stat().st_mode & 0o027:
            raise ValueError("Protect the config directory before creating a config")
        descriptor = os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            os.fchown(output.fileno(), 0, account.pw_gid)
            os.fchmod(output.fileno(), 0o640)
            output.write((ROOT / "server/config.example.json").read_bytes())
    check_config(CONFIG, account.pw_gid)
    from castoriceui.config import AppConfig
    config = AppConfig.load(CONFIG)
    check_state(Path(config.login_background_directory), account.pw_uid, account.pw_gid, directory=True)
    result["config"] = "verified"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Create missing panel prerequisites without overwriting existing files")
    parser.add_argument("--check-site", action="store_true", help="Include the read-only preflight of the configured TLS site")
    args = parser.parse_args()
    result = plan()
    result["mutationFree"] = not args.apply
    code = 0
    if result["missingDependencies"]:
        result["errorCategory"], code = "missing_dependency", 69
    elif args.apply:
        try:
            prepare(result)
        except (OSError, KeyError, TypeError, ValueError, subprocess.SubprocessError):
            result["errorCategory"], code = "unsafe_configuration", 78
            result["message"] = "Check the service account, config and data ownership. Existing files are preserved."
    if code == 0 and args.check_site:
        from preflight import inspect
        result["preflight"] = inspect(str(CONFIG))
        code = result["preflight"]["exitCode"]
        if code:
            result["errorCategory"] = result["preflight"]["errorCategory"]
    print(json.dumps({**result, "ok": code == 0, "exitCode": code}))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
