"""Bounded real ICMP observations, separate from global alert evaluation."""
from collections import deque
from datetime import datetime
import statistics
import time
from typing import Any


class NetworkSeries:
    def __init__(self) -> None:
        self.samples: dict[str, deque] = {}
        self.signatures: dict[str, tuple] = {}

    def clear(self) -> None:
        self.samples.clear()
        self.signatures.clear()

    def retain(self, ids: set[str]) -> None:
        self.samples = {key: value for key, value in self.samples.items() if key in ids}
        self.signatures = {key: value for key, value in self.signatures.items() if key in ids}

    def append(self, target: dict[str, Any]) -> None:
        key = target["id"]
        signature = (target["address"], target.get("resolvedIpVersion") or target.get("ipVersion"))
        if self.signatures.get(key) != signature:
            self.samples[key] = deque(maxlen=60)
            self.signatures[key] = signature
        at = target.get("sampleEndedAt") or target.get("observedAt")
        try:
            captured = datetime.fromisoformat(str(at).replace("Z", "+00:00")).timestamp()
        except (ValueError, TypeError):
            captured = time.time()
        complete = bool(target.get("complete") and target.get("measurementStatus") == "measured")
        point = {"capturedAt": captured, "latency": target.get("latency"), "loss": target.get("loss"),
                 "complete": complete, "status": target.get("status", "unavailable"),
                 "sent": target.get("sent"), "received": target.get("received")}
        rows = self.samples[key]
        if not rows or rows[-1]["capturedAt"] != captured:
            rows.append(point)
        target["observedAt"] = at or target.get("observedAt")
        target["sampleIntervalSeconds"] = 1
        target["probeHistory"] = [{field: sample[field] for field in ("capturedAt", "latency", "loss", "complete", "status")} for sample in rows]
        values = [sample["latency"] for sample in rows if sample["complete"] and isinstance(sample["latency"], (int, float))]
        target["history"] = values
        target["jitter"] = round(statistics.pstdev(values), 1) if len(values) > 1 else None

    def aggregate(self, target: dict[str, Any], since: float) -> dict[str, Any]:
        rows = [row for row in self.samples.get(target["id"], ()) if row["capturedAt"] > since]
        usable = [row for row in rows if row["complete"] and isinstance(row["sent"], int) and isinstance(row["received"], int)]
        sent = sum(row["sent"] for row in usable)
        received = sum(row["received"] for row in usable)
        values = [row["latency"] for row in usable if isinstance(row["latency"], (int, float))]
        complete = bool(rows) and all(row["complete"] for row in rows)
        gaps = not complete or any(b["capturedAt"] - a["capturedAt"] > 1.6 for a, b in zip(rows, rows[1:]))
        return {**{field: target.get(field) for field in ("id", "observedAt", "ipVersion", "resolvedIpVersion", "status", "jitter")},
                "latency": max(values) if values else None, "loss": round(100 * (sent - received) / sent, 2) if sent else None,
                "sent": sent, "received": received, "complete": complete, "hasGaps": gaps,
                "sampleIntervalSeconds": 20, "measurementStatus": "measured" if usable else "unavailable"}
