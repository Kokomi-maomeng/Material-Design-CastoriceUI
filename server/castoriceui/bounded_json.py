"""Bound the shape of JSON before the decoder allocates nested objects."""
import json
import math
import re
from typing import Any

_TOKEN = re.compile(r'["\\\[\]{},:]')


class JsonLimitError(ValueError):
    pass


def _finite(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite JSON number")
    return number


def loads(data: str | bytes, *, max_items: int = 20_000) -> Any:
    text = data.decode("utf-8-sig") if isinstance(data, bytes) else data
    depth = items = skip_before = 0
    in_string = False
    for match in _TOKEN.finditer(text):
        first = match[0][0]
        if in_string and first == "\\" and match.start() >= skip_before:
            skip_before = match.end() + 1
            continue
        if first == '"' and match.start() >= skip_before:
            in_string = not in_string
            continue
        if in_string or first == "\\":
            continue
        if first in "[{":
            depth += 1
            if depth > 32:
                raise JsonLimitError("JSON nesting exceeds 32 levels")
        elif first in "]}":
            depth -= 1
            if depth < 0:
                break  # The JSON decoder reports the syntax error.
            continue
        items += 1
        if items > max_items:
            raise JsonLimitError("JSON exceeds the item limit")
    try:
        return json.loads(text, parse_float=_finite, parse_constant=_finite)
    except RecursionError as error:
        raise JsonLimitError("JSON nesting exceeds the decoder limit") from error
