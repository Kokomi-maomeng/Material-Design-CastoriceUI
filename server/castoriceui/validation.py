"""Strict JSON scalar validation shared by mutation endpoints."""
from __future__ import annotations

import math
import re
from typing import Any


def integer(value: Any, field: str) -> int:
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"[+-]?\d{1,18}", value.strip()):
        return int(value)
    raise ValueError(f"{field} must be an integer")


def number(value: Any, field: str) -> float:
    if type(value) not in {int, float, str}:
        raise ValueError(f"{field} must be a finite number")
    try:
        result = float(value)
    except (ValueError, OverflowError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(result):
        raise ValueError(f"{field} must be a finite number")
    return result


def boolean(value: Any, field: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{field} must be a boolean")
    return value


def text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value
