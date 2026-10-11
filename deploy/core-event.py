"""Record a core start independently of panel polling, then refresh inventory."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    unit = sys.argv[1]
    if unit not in {"sing-box.service", "hysteria-server.service"}:
        raise SystemExit(64)
    root = Path("/run/castoriceui")
    root.mkdir(mode=0o755, exist_ok=True)
    with (root / "core-events.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        destination = root / "core-events.json"
        try:
            events = json.loads(destination.read_text())[-63:]
        except (OSError, ValueError):
            events = []
        properties = subprocess.run(["systemctl", "show", unit, "-p", "MainPID", "-p", "NRestarts", "-p", "InvocationID"], capture_output=True, text=True, timeout=3, check=True).stdout
        fields = dict(line.split("=", 1) for line in properties.splitlines() if "=" in line)
        events.append({"unit": unit, "observedAt": time.time(), "event": "core-start", **fields})
        fd, temporary = tempfile.mkstemp(dir=root, prefix=".event-")
        with os.fdopen(fd, "w") as handle:
            json.dump(events, handle)
            os.fchmod(handle.fileno(), 0o644)
        os.replace(temporary, destination)
    subprocess.run(["systemctl", "--no-block", "start", "castoriceui-protocol-probe.service"], timeout=3, check=False, capture_output=True)


if __name__ == "__main__":
    main()
