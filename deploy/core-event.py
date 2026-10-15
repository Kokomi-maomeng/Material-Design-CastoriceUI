"""Record a core start independently of panel polling, then refresh inventory."""
import fcntl
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    unit = sys.argv[1]
    policy = Path("/etc/castoriceui/core-event-units.json")
    try:
        metadata = policy.lstat()
        if policy.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022 or metadata.st_size > 4096:
            raise ValueError("Unsafe event policy")
        allowed = json.loads(policy.read_text())
        if not isinstance(allowed, list):
            raise ValueError("Invalid event policy")
    except (OSError, ValueError):
        raise SystemExit(64)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}\.service", unit) or unit not in allowed:
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
