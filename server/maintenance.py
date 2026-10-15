#!/usr/bin/env python3
"""Local protected maintenance; archives may contain private operational data."""
import argparse
import json
import os
from pathlib import Path
from castoriceui.alert_archive import archive, capacity, restore
from castoriceui.config import AppConfig
from castoriceui.storage import Storage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/castoriceui/config.json")
    commands = parser.add_subparsers(dest="operation", required=True)
    commands.add_parser("status")
    commands.add_parser("unlock-login")
    commands.add_parser("archive-alerts")
    restore_parser = commands.add_parser("restore-alerts")
    restore_parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    if getattr(os, "geteuid", lambda: -1)() != 0:
        raise SystemExit("Run this local maintenance command as root")
    # Root authorizes the operation; state access then uses the backend identity.
    # Service-writable paths cannot drive privileged filesystem writes.
    import pwd
    account = pwd.getpwnam("castoriceui")
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    config = AppConfig.load(args.config)
    storage = Storage(config.database_path, config.audit_retention_days)
    if args.operation == "unlock-login":
        with storage.lock, storage.connect() as connection:
            connection.execute("DELETE FROM login_failures")
        storage.add_audit("解除登录限流", "认证", "本地受保护运维命令已清除失败计数", actor="local-operator")
        result = {"unlocked": True}
    elif args.operation == "archive-alerts":
        result = archive(storage, Path(config.database_path).parent / "alert-archives", days=config.alert_retention_days, limit=config.alert_history_limit)
    elif args.operation == "restore-alerts":
        result = {"restored": restore(storage, args.archive)}
    else:
        result = capacity(storage, config.alert_history_limit)
    print(json.dumps({**result, "effectiveUid": os.geteuid()}))


if __name__ == "__main__":
    main()
