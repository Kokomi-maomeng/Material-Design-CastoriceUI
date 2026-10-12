"""Authenticated, bounded external business evidence; no proxy credentials."""
import hashlib
import hmac
import json
import re
import sqlite3
import time


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def accept(config, storage, payload: dict, signature: str) -> bool:
    if not config.external_probe_secret or not isinstance(signature, str) or len(signature) != 64:
        return False
    if not isinstance(payload, dict) or set(payload) != {"agentId", "nonce", "observedAt", "agentHealthy", "protocols"}:
        return False
    try:
        encoded = canonical(payload)
        if len(encoded) > 8192 or not hmac.compare_digest(hmac.new(config.external_probe_secret.encode(), encoded, hashlib.sha256).hexdigest(), signature):
            return False
        now = int(time.time())
        if type(payload["observedAt"]) not in {int, float} or not abs(now - payload["observedAt"]) <= 60:
            return False
        if payload["agentId"] not in config.external_probe_agents or not isinstance(payload["nonce"], str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}", payload["nonce"]):
            return False
        protocols = payload["protocols"]
        if type(payload["agentHealthy"]) is not bool or not isinstance(protocols, dict) or not protocols or set(protocols) - {"anytls", "hysteria2"}:
            return False
        for item in protocols.values():
            if not isinstance(item, dict) or set(item) - {"status", "failedStage", "durationMs", "certificateSha256", "existingConnection"} or item.get("status") not in {"passed", "failed", "unavailable"}:
                return False
            if item.get("failedStage", "") not in {"", "observer", "transport", "tls", "quic", "authentication", "forwarding"}:
                return False
            if "durationMs" in item and (type(item["durationMs"]) not in {int, float} or not 0 <= item["durationMs"] <= 60000):
                return False
            if "certificateSha256" in item and not re.fullmatch(r"[a-f0-9]{64}", str(item["certificateSha256"])):
                return False
            if "existingConnection" in item and type(item["existingConnection"]) is not bool:
                return False
        with storage.lock, storage.connect() as connection:
            connection.execute("DELETE FROM probe_nonces WHERE captured_at<?", (now - 120,))
            if connection.execute("SELECT COUNT(*) FROM probe_nonces").fetchone()[0] >= 1000:
                return False
            connection.execute("INSERT INTO probe_nonces VALUES(?,?)", (payload["nonce"], now))
        return storage.record_monitoring("external", payload["agentId"], payload)
    except (ValueError, TypeError, sqlite3.Error):
        return False


def service_evidence(config, storage, active_ids: set[str], *, now: float | None = None, startup_age: float = 0) -> list[dict]:
    """Observer failures/stale reports cannot establish a VPS outage."""
    now = time.time() if now is None else now
    history = storage.monitoring_history("external", since=int(now - 600), limit=160)
    services = []
    for agent in config.external_probe_agents if config.external_probe_secret else []:
        records = [item for item in history if item.get("agentId") == agent]
        for protocol, label in (("anytls", "AnyTLS"), ("hysteria2", "HY2")):
            relevant = [item for item in records if protocol in item.get("protocols", {})]
            latest = relevant[-1] if relevant else {}
            measured = latest.get("protocols", {}).get(protocol, {})
            fresh = bool(latest) and 0 <= now - latest["observedAt"] <= 180
            observer = fresh and latest.get("agentHealthy") is True
            passed = observer and measured.get("status") == "passed"
            key = f"external-{agent}-{protocol}"
            tail = relevant[-2:]
            def matching(status):
                return len(tail) == 2 and all(item.get("agentHealthy") is True and 0 <= now - item["observedAt"] <= 180 and item["protocols"][protocol].get("status") == status for item in tail)
            confirmed = observer and (matching("failed") or key in active_ids and not matching("passed"))
            unknown = not observer or measured.get("status") == "unavailable"
            reason = "external_observer_unavailable" if unknown else "external_business_failure" if not passed or confirmed else "external_business_passed"
            services.append({"id": key, "name": f"{label} external · {agent}", "nameEn": f"{label} external · {agent}", "nameZh": f"{label} 外部业务 · {agent}", "icon": "travel_explore", "kind": "monitor", "status": "running" if passed and not confirmed else "warning", "version": "synthetic probe", "detail": "External forwarding verified" if passed and not confirmed else "External observer evidence unavailable" if unknown else "External business path requires attention", "detailEn": "External forwarding verified" if passed and not confirmed else "External observer evidence unavailable" if unknown else "External business path requires attention", "detailZh": "外部认证与转发验证通过" if passed and not confirmed else "外部观测点证据不可用，无法判断 VPS 业务" if unknown else "外部业务验证失败或等待连续正常确认", "stateReason": reason, "alertConfirmed": bool(confirmed or unknown and (bool(latest) or startup_age >= 180)), "evidence": {"agentId": agent, "protocol": protocol, "observedAt": latest.get("observedAt"), "ageSeconds": round(now - latest["observedAt"], 1) if latest else None, "observerHealthy": bool(observer), "fresh": fresh, "result": measured}})
    return services
