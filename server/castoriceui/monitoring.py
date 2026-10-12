"""Bounded monitoring policy. No credentials, destinations or service mutations."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import threading
import time
from typing import Any, Callable


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


_log_lock = threading.Lock()
_log_state: dict[str, tuple[float, int]] = {}


def event(module: str, reason: str, **fields: Any) -> None:
    """Only caller-selected numeric fields and exception categories are logged."""
    key = module + ":" + reason
    with _log_lock:
        previous, count = _log_state.get(key, (0.0, 0))
        now = time.monotonic()
        if now - previous < 60:
            _log_state[key] = previous, count + 1
            return
        _log_state[key] = now, 0
    safe = {key: value for key, value in fields.items() if key in {"durationMs", "missed", "exceptionType", "count"}}
    print(json.dumps({"occurredAt": timestamp(), "module": module, "reason": reason,
                      "suppressed": count, **safe}, ensure_ascii=True), flush=True)


def periodic(stop: threading.Event, name: str, period: float, function: Callable[[], Any]) -> threading.Thread:
    """One thread per domain; fixed deadlines, no overlap or catch-up storms."""
    def loop() -> None:
        deadline = time.monotonic()
        while not stop.is_set():
            started = time.monotonic()
            try:
                function()
            except Exception as error:
                event(name, "collection_failed", exceptionType=type(error).__name__)
            elapsed = time.monotonic() - started
            deadline += period
            missed = max(0, math.floor((time.monotonic() - deadline) / period) + 1)
            if missed:
                deadline += missed * period
                event(name, "deadline_missed", durationMs=round(elapsed * 1000), missed=missed)
            stop.wait(max(0, deadline - time.monotonic()))
    thread = threading.Thread(target=loop, name=name, daemon=True)
    thread.start()
    return thread


class NetworkPolicy:
    """120s weighted packet window, 2/3 bad confirmation, two good recovery."""
    def __init__(self) -> None:
        self.samples: dict[str, deque] = {}
        self.states: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def apply(self, targets: list[dict[str, Any]], thresholds: dict[str, float], now: float | None = None) -> list[dict[str, Any]]:
        now = time.time() if now is None else now
        with self.lock:
            ids = {str(item["id"]) for item in targets}
            self.samples = {key: value for key, value in self.samples.items() if key in ids}
            self.states = {key: value for key, value in self.states.items() if key in ids}
            for target in targets:
                key = str(target["id"])
                effective = {"latencyMs": float(target.get("latencyMs", thresholds["latencyMs"])),
                             "lossPercent": float(target.get("lossPercent", thresholds["lossPercent"]))}
                target["effectivePolicy"] = {**effective, "windowSeconds": 120, "minimumPackets": 24,
                                             "confirmationRounds": 2, "recoveryRounds": 2}
                bad = (target.get("loss") is not None and target["loss"] >= effective["lossPercent"]) or (target.get("latency") is not None and target["latency"] >= effective["latencyMs"])
                complete = target.get("complete", target.get("measurementStatus") == "measured")
                sent = target.get("sent")
                received = target.get("received")
                usable = complete and isinstance(sent, int) and isinstance(received, int) and 0 <= received <= sent and sent > 0
                samples = self.samples.setdefault(key, deque(maxlen=12))
                signature = (effective["latencyMs"], effective["lossPercent"])
                state = self.states.setdefault(key, {"confirmed": False, "good": 0, "policy": signature})
                target_signature = (target.get("address"), target.get("resolvedIpVersion") or target.get("ipVersion"))
                if state["policy"] != signature or state.get("targetSignature", target_signature) != target_signature:
                    samples.clear()
                    state.update(confirmed=False, good=0, policy=signature)
                state["targetSignature"] = target_signature
                samples.append({"at": now, "usable": usable, "sent": sent if usable else 0,
                                "received": received if usable else 0, "bad": bool(bad),
                                "latency": target.get("latency") if usable else None})
                while samples and samples[0]["at"] < now - 120:
                    samples.popleft()
                total_sent = sum(item["sent"] for item in samples)
                total_received = sum(item["received"] for item in samples)
                loss = 100 * (total_sent - total_received) / total_sent if total_sent else None
                tail = list(samples)[-3:]
                persistent = sum(bool(item["usable"] and item["bad"]) for item in tail) >= 2
                # All ICMP replies missing stays visible immediately; corroborated
                # TCP/DNS failures permit early confirmation without a long window.
                layers = [value for value in target.get("layers", {}).values() if value.get("configured")]
                corroborated = target.get("loss") == 100 and layers and all(value.get("status") == "failed" for value in layers)
                ready = total_sent >= 24
                window_bad = loss is not None and loss >= effective["lossPercent"]
                if usable and bad and ((ready and persistent and (window_bad or target.get("latency", 0) is not None and target["latency"] >= effective["latencyMs"])) or corroborated):
                    state.update(confirmed=True, good=0)
                elif usable and not bad:
                    state["good"] += 1
                    if state["good"] >= 2:
                        state["confirmed"] = False
                else:
                    state["good"] = 0
                target["rawStatus"] = target.get("status", "unavailable")
                if target.get("status") not in {"down", "unavailable"}:
                    target["status"] = "degraded" if bad else "healthy"
                target["alertConfirmed"] = bool(state["confirmed"])
                target["qualityWindow"] = {"sent": total_sent, "received": total_received,
                                           "loss": round(loss, 2) if loss is not None else None,
                                           "ready": ready, "confirmation": "confirmed" if state["confirmed"] else "observing" if bad else "normal"}
            return targets


def correlate(targets: list[dict[str, Any]]) -> dict[str, Any]:
    """Candidate correlation is never a provider or line root-cause claim."""
    bad = [item for item in targets if item.get("status") in {"down", "degraded"}]
    return {"observedAt": timestamp(), "scope": "outbound-icmp",
            "classification": "multiple-targets" if len(bad) > 1 else "target-direction" if bad else "no-current-anomaly",
            "affectedTargets": [item["id"] for item in bad],
            "ipVersions": sorted({int(item.get("resolvedIpVersion") or item.get("ipVersion", 0)) for item in bad}),
            "normalSamples": sum(item.get("status") == "healthy" and item.get("complete", True) for item in targets),
            "officialIncident": "not_checked", "rootCause": "insufficient_evidence"}


class ResourcePressure:
    def __init__(self) -> None:
        self.previous: dict[str, int] = {}
        self.burst_until = 0.0
        self.lock = threading.Lock()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return self._snapshot()

    def _snapshot(self) -> dict[str, Any]:
        result: dict[str, Any] = {"observedAt": timestamp()}
        try:
            group = next(line.split(":", 2)[2] for line in Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::"))
            base = Path("/sys/fs/cgroup") / group.lstrip("/")
            counters = dict((key, int(value)) for key, value in (line.split() for line in (base / "memory.events").read_text().splitlines()))
            delta = {key: max(0, value - self.previous.get(key, value)) for key, value in counters.items()}
            self.previous = counters
            result.update(memoryEvents=counters, memoryEventDelta=delta,
                          memoryBytes=int((base / "memory.current").read_text()),
                          memoryPressure=(base / "memory.pressure").read_text().strip(),
                          taskCount=int((base / "pids.current").read_text()),
                          fileDescriptors=len(list(Path("/proc/self/fd").iterdir())))
            if delta.get("high", 0) or delta.get("oom", 0):
                self.burst_until = max(self.burst_until, time.monotonic() + 60)
            result["burstActive"] = time.monotonic() < self.burst_until
            result["tcpCounters"] = Path("/proc/net/snmp").read_text()[:8000]
            result["tcpExtendedCounters"] = Path("/proc/net/netstat").read_text()[:16000]
            result["cpuCounters"] = Path("/proc/stat").read_text().splitlines()[0]
            result["networkCounters"] = Path("/proc/net/dev").read_text()[:8000]
        except (OSError, ValueError, StopIteration):
            result["reason"] = "resource_evidence_unavailable"
        return result


def maintenance_info(path: Path = Path("/run/castoriceui/certificate-maintenance.json"), now: float | None = None) -> dict[str, Any]:
    """A bounded maintenance annotation never overrides real failure evidence."""
    try:
        if path.stat().st_size > 4096:
            return {"state": "invalid"}
        data = json.loads(path.read_text())
        start, expires = float(data["startedAt"]), float(data["expiresAt"])
        if not isinstance(data.get("id"), str) or len(data["id"]) > 64 or not start <= expires <= start + 120:
            return {"state": "invalid"}
        state = data.get("state")
        if state not in {"activating", "verified", "rolled_back", "activation_failed", "preparation_failed"}:
            return {"state": "invalid"}
        return {key: data[key] for key in ("id", "startedAt", "expiresAt", "endedAt", "state", "certificateSha256", "reason") if key in data} | {"expired": state == "activating" and (time.time() if now is None else now) > expires}
    except (OSError, ValueError, TypeError, KeyError):
        return {"state": "unavailable"}
