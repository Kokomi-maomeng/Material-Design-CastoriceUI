"""Public alert fields, including compatibility with existing stored episodes."""
from typing import Any


def with_alert_time(payload: dict[str, Any], occurred_at: str) -> dict[str, Any]:
    # Existing episode timestamps are authoritative; never reset them on polling.
    if not isinstance(payload.get("time"), str) or not payload["time"]:
        payload = {**payload, "time": occurred_at}
    return payload
