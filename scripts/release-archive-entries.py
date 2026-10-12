"""Return tar member bytes to the local scanner; never extract archive paths."""
import base64
import json
import pathlib
import sys
import tarfile

try:
    result = []
    total = 0
    with tarfile.open(sys.argv[1]) as archive:
        for member in archive:
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or "\\" in member.name or ":" in member.name:
                raise ValueError("Unsafe archive path")
            if not member.isdir() and not member.isfile():
                raise ValueError("Archive links and special entries are forbidden")
            total += member.size
            if total > 128 * 1024 * 1024:
                raise ValueError("Archive exceeds bounded inspection size")
            data = archive.extractfile(member).read() if member.isfile() else b""
            result.append({"name": member.name, "owner": member.uname + "\n" + member.gname + "\n" + json.dumps(member.pax_headers), "content": base64.b64encode(data).decode("ascii")})
    print(json.dumps(result))
except Exception:
    print("Archive inspection blocked", file=sys.stderr)
    sys.exit(1)
