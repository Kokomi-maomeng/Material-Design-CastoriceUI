"""Pinned Debian cloud images shared by CI planning and actual VM acceptance."""
import json
import re
from pathlib import Path


def pinned_images() -> dict:
    entries = json.loads(Path(__file__).with_name("debian-images.json").read_text(encoding="utf-8"))
    for version, suite in (("12", "bookworm"), ("13", "trixie")):
        image = entries[version]
        if (image["suite"] != suite or not re.fullmatch(r"\d{8}-\d+", image["build"])
                or image["file"] != f"debian-{version}-generic-amd64-{image['build']}.qcow2"
                or not re.fullmatch("[a-f0-9]{128}", image["sha512"])):
            raise ValueError("Malformed pinned Debian image")
    return entries
