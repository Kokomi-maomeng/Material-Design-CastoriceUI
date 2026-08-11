#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import secrets
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from castoriceui.api import ApiServer  # noqa: E402
from castoriceui import __version__  # noqa: E402
from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
from castoriceui.storage import Storage  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="CastoriceUI local backend")
    parser.add_argument("--config", default="/etc/castoriceui/config.json")
    parser.add_argument("--generate-bootstrap", action="store_true", help="create and print a one-time first-run token")
    args = parser.parse_args()
    config = AppConfig.load(args.config)
    if args.generate_bootstrap:
        token_path = Path(config.bootstrap_token_path)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(32)
        descriptor = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(token + "\n")
        print(token)
        return
    storage = Storage(config.database_path)
    dashboard = DashboardService(config, storage)
    server = ApiServer(config, storage, dashboard)
    storage.add_audit("后端启动", "系统", f"CastoriceUI {__version__} 数据服务已启动")
    sampler_stop = threading.Event()

    def sample_traffic() -> None:
        while not sampler_stop.is_set():
            try:
                with dashboard.snapshot_lock:
                    dashboard.system_collector.snapshot()
            except Exception as error:  # keep collection alive; systemd captures the diagnostic
                print(f"Traffic sampler failed: {error}")
            sampler_stop.wait(60)

    threading.Thread(target=sample_traffic, name="traffic-sampler", daemon=True).start()
    print(f"CastoriceUI backend listening on {config.listen_host}:{config.listen_port}")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        sampler_stop.set()
        time.sleep(0)


if __name__ == "__main__":
    main()
