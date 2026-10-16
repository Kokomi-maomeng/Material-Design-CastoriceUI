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
from castoriceui.monitoring import periodic, event  # noqa: E402


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
    storage = Storage(config.database_path, config.audit_retention_days)
    dashboard = DashboardService(config, storage)
    server = ApiServer(config, storage, dashboard)
    storage.add_audit("后端启动", "系统", f"CastoriceUI {__version__} 数据服务已启动")
    sampler_stop = threading.Event()

    periodic(sampler_stop, "host", 60, dashboard.collect_system_snapshot)
    periodic(sampler_stop, "hysteria-statistics", 5, lambda: dashboard.refresh_adapter("hysteria2"))
    periodic(sampler_stop, "singbox-statistics", 5, lambda: dashboard.refresh_adapter("singbox"))
    periodic(sampler_stop, "network", 20, dashboard.refresh_network)
    periodic(sampler_stop, "subscriptions", 60, dashboard.refresh_subscription)
    periodic(sampler_stop, "auxiliary", 600, dashboard.refresh_auxiliary)
    periodic(sampler_stop, "runtime-monitor", 5, dashboard.refresh_services)
    periodic(sampler_stop, "watchdog", 5, dashboard.refresh_collection_alerts)
    from castoriceui.alert_archive import archive
    periodic(sampler_stop, "alert-archive", 3600, lambda: archive(storage, Path(config.database_path).parent / "alert-archives", days=config.alert_retention_days, limit=config.alert_history_limit, minimum_batch=100))
    def pressure_burst() -> None:
        if time.monotonic() < dashboard.resource_pressure.burst_until:
            storage.record_monitoring("resource", "backend", dashboard.resource_pressure.snapshot())
    periodic(sampler_stop, "resource-burst", 10, pressure_burst)
    event("backend", "listening")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        sampler_stop.set()
        time.sleep(0)


if __name__ == "__main__":
    main()
