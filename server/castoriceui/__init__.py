"""CastoriceUI backend package."""

import json
from pathlib import Path


def _project_version() -> str:
    try:
        metadata = json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text(encoding="utf-8"))
        return str(metadata["version"])
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        from ._version import VERSION

        return VERSION


__version__ = _project_version()
