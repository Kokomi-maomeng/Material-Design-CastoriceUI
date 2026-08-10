#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from castoriceui.api import ApiServer  # noqa: E402
from castoriceui.config import AppConfig  # noqa: E402
from castoriceui.dashboard import DashboardService  # noqa: E402
from castoriceui.storage import Storage  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="CastoriceUI local backend")
    parser.add_argument("--config", default="/etc/castoriceui/config.json")
    args = parser.parse_args()
    config = AppConfig.load(args.config)
    storage = Storage(config.database_path)
    dashboard = DashboardService(config, storage)
    server = ApiServer(config, storage, dashboard)
    storage.add_audit("后端启动", "系统", "CastoriceUI 1.3 数据服务已启动")
    print(f"CastoriceUI backend listening on {config.listen_host}:{config.listen_port}")
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
