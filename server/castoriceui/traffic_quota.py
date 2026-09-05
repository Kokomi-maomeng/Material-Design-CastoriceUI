from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


QUOTA_STATE_VERSION = 2
PERIOD_UNITS = {"day", "week", "month", "year"}
COUNT_MODES = {"sum", "max"}


def utc_cycle_id(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _zone(timezone_name: str) -> timezone | ZoneInfo:
    if timezone_name == "UTC":
        return timezone.utc
    return ZoneInfo(timezone_name)


def validate_timezone(value: Any) -> str:
    timezone_name = str(value or "UTC").strip() or "UTC"
    try:
        _zone(timezone_name)
    except (ZoneInfoNotFoundError, TypeError) as error:
        raise ValueError("timezone must be UTC or an installed IANA timezone") from error
    return timezone_name


def _month_at(anchor: date, month_index: int) -> date:
    year = anchor.year + (anchor.month - 1 + month_index) // 12
    month = (anchor.month - 1 + month_index) % 12 + 1
    return date(year, month, min(anchor.day, monthrange(year, month)[1]))


def traffic_quota_period(
    now: datetime,
    quota: dict[str, Any],
    legacy_day: int = 1,
    legacy_timezone: str = "UTC",
) -> tuple[datetime, datetime | None, dict[str, Any]]:
    """Return the active quota period and its normalized public schedule."""
    timezone_name = validate_timezone(quota.get("timezone") or legacy_timezone or "UTC")
    zone = _zone(timezone_name)
    local_now = now.astimezone(zone)
    unit = str(quota.get("periodUnit") or "month")
    if unit not in PERIOD_UNITS:
        unit = "month"
    try:
        count = max(1, min(int(quota.get("periodCount", 1)), 365))
    except (TypeError, ValueError):
        count = 1
    try:
        anchor = date.fromisoformat(str(quota.get("resetAnchor") or ""))
    except ValueError:
        anchor = date(2000, 1, max(1, min(int(legacy_day), 28)))
    reset_time_text = str(quota.get("resetTime") or "00:00")
    try:
        reset_hour, reset_minute = (int(value) for value in reset_time_text.split(":"))
        if not 0 <= reset_hour <= 23 or not 0 <= reset_minute <= 59:
            raise ValueError
    except (TypeError, ValueError):
        reset_hour, reset_minute = 0, 0
        reset_time_text = "00:00"
    reset_time = datetime_time(reset_hour, reset_minute)
    auto_reset = bool(quota.get("autoReset", False))

    if not auto_reset:
        try:
            fixed = datetime.fromisoformat(str(quota.get("fixedCycleStart", "")).replace("Z", "+00:00"))
            if fixed.tzinfo is None:
                fixed = fixed.replace(tzinfo=zone)
        except ValueError:
            fixed = datetime.combine(anchor, datetime.min.time(), zone)
        start = min(fixed.astimezone(timezone.utc), now.astimezone(timezone.utc))
        return start, None, {
            "autoReset": False,
            "periodUnit": unit,
            "periodCount": count,
            "resetAnchor": anchor.isoformat(),
            "resetTime": reset_time_text,
            "timezone": timezone_name,
            "fixedCycleStart": utc_cycle_id(start),
        }

    if unit in {"day", "week"}:
        step_days = count * (7 if unit == "week" else 1)
        elapsed = (local_now.date() - anchor).days
        periods = elapsed // step_days
        start_date = anchor + timedelta(days=periods * step_days)
        if datetime.combine(start_date, reset_time, zone) > local_now:
            start_date -= timedelta(days=step_days)
        next_date = start_date + timedelta(days=step_days)
    else:
        step_months = count * (12 if unit == "year" else 1)
        elapsed_months = (local_now.year - anchor.year) * 12 + local_now.month - anchor.month
        periods = elapsed_months // step_months
        start_date = _month_at(anchor, periods * step_months)
        if datetime.combine(start_date, reset_time, zone) > local_now:
            periods -= 1
            start_date = _month_at(anchor, periods * step_months)
        next_date = _month_at(anchor, (periods + 1) * step_months)
    start = datetime.combine(start_date, reset_time, zone).astimezone(timezone.utc)
    next_reset = datetime.combine(next_date, reset_time, zone).astimezone(timezone.utc)
    return start, next_reset, {
        "autoReset": True,
        "periodUnit": unit,
        "periodCount": count,
        "resetAnchor": anchor.isoformat(),
        "resetTime": reset_time_text,
        "timezone": timezone_name,
    }


def normalize_quota_state(
    raw: Any,
    *,
    default_bytes: int,
    legacy_day: int = 1,
    legacy_timezone: str = "UTC",
    legacy_count_mode: str = "sum",
    legacy_initial_bytes: int = 0,
    legacy_initial_cycle: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Normalize persisted v1/v2 settings into the single v2 quota model."""
    current = dict(raw) if isinstance(raw, dict) else {}
    now = now or datetime.now(timezone.utc)
    try:
        quota_bytes = int(current.get("bytes", default_bytes))
    except (TypeError, ValueError):
        quota_bytes = int(default_bytes)
    quota_bytes = max(1_000_000_000, min(quota_bytes, 1_000_000_000_000_000))
    count_mode = str(current.get("countMode") or legacy_count_mode)
    if count_mode not in COUNT_MODES:
        count_mode = "sum"

    cycle_start, _, schedule = traffic_quota_period(now, current, legacy_day, legacy_timezone)
    baseline = current.get("baseline", {})
    if not isinstance(baseline, dict):
        baseline = {}
    try:
        baseline_bytes = max(0, int(baseline.get("bytes", 0)))
    except (TypeError, ValueError):
        baseline_bytes = 0
    baseline_cycle = str(baseline.get("cycleStart") or "")
    if not baseline_cycle and legacy_initial_bytes > 0 and legacy_initial_cycle == cycle_start.date().isoformat():
        baseline_bytes = int(legacy_initial_bytes)
        baseline_cycle = utc_cycle_id(cycle_start)

    return {
        "schema": QUOTA_STATE_VERSION,
        "bytes": quota_bytes,
        **schedule,
        "countMode": count_mode,
        "baseline": {"bytes": baseline_bytes, "cycleStart": baseline_cycle},
    }


def baseline_for_cycle(state: dict[str, Any], cycle_start: datetime) -> int:
    baseline = state.get("baseline", {})
    if not isinstance(baseline, dict) or str(baseline.get("cycleStart") or "") != utc_cycle_id(cycle_start):
        return 0
    try:
        return max(0, int(baseline.get("bytes", 0)))
    except (TypeError, ValueError):
        return 0
