#!/bin/sh
set -eu

usage() {
    echo "Usage: $0 --archive /path/to/CastoriceUI-vX.Y.Z.tar.gz [--config /etc/castoriceui/config.json]" >&2
    exit 2
}

archive=""
config_path="/etc/castoriceui/config.json"
while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive) [ "$#" -ge 2 ] || usage; archive=$2; shift 2 ;;
        --config) [ "$#" -ge 2 ] || usage; config_path=$2; shift 2 ;;
        *) usage ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -n "$archive" ] && [ -f "$archive" ] || usage
[ -f "$config_path" ] || { echo "Protected config not found: $config_path" >&2; exit 1; }

archive=$(realpath "$archive")
case "$(basename "$archive")" in
    CastoriceUI-v[0-9]*.[0-9]*.[0-9]*.tar.gz) ;;
    *) echo "Archive name must be CastoriceUI-vX.Y.Z.tar.gz" >&2; exit 1 ;;
esac
version=$(basename "$archive" | sed -n 's/^CastoriceUI-v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\.tar\.gz$/\1/p')
[ -n "$version" ] || { echo "Unable to determine release version." >&2; exit 1; }

backend_root=/opt/castoriceui
frontend_root=/var/www/castorice-ui
backend_release="$backend_root/releases/v$version"
frontend_release="$frontend_root/releases/v$version"
backend_link="$backend_root/current"
frontend_link="$frontend_root/current"
unit_path=/etc/systemd/system/castoriceui-backend.service
probe_unit_path=/etc/systemd/system/castoriceui-protocol-probe.service
probe_timer_path=/etc/systemd/system/castoriceui-protocol-probe.timer

install -d -m 0755 "$backend_root/releases" "$frontend_root/releases"
[ ! -e "$backend_release" ] || { echo "Backend release already exists: $backend_release" >&2; exit 1; }
[ ! -e "$frontend_release" ] || { echo "Frontend release already exists: $frontend_release" >&2; exit 1; }

staging=$(mktemp -d "$backend_root/releases/.staging-v$version.XXXXXX")
backup_root=$(mktemp -d "/var/backups/castoriceui-v$version-$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
old_backend=$(readlink -f "$backend_link" 2>/dev/null || true)
old_frontend=$(readlink -f "$frontend_link" 2>/dev/null || true)
switched=0
database_path=""
database_backed_up=0
probe_unit_existed=0
probe_timer_existed=0
probe_timer_was_enabled=0

cleanup() {
    case "$staging" in "$backend_root"/releases/.staging-v$version.*) rm -rf -- "$staging" ;; esac
}

rollback() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ "$switched" -eq 1 ]; then
        echo "Deployment failed; restoring recorded panel release links." >&2
        if [ -n "$old_backend" ]; then ln -sfn "$old_backend" "$backend_link.next"; mv -Tf "$backend_link.next" "$backend_link"; else [ "$(readlink -f "$backend_link" 2>/dev/null || true)" != "$backend_release" ] || rm -f -- "$backend_link"; fi
        if [ -n "$old_frontend" ]; then ln -sfn "$old_frontend" "$frontend_link.next"; mv -Tf "$frontend_link.next" "$frontend_link"; else [ "$(readlink -f "$frontend_link" 2>/dev/null || true)" != "$frontend_release" ] || rm -f -- "$frontend_link"; fi
        if [ -f "$backup_root/castoriceui-backend.service" ]; then
            install -m 0644 "$backup_root/castoriceui-backend.service" "$unit_path"
        fi
        if [ "$probe_unit_existed" -eq 1 ]; then install -m 0644 "$backup_root/castoriceui-protocol-probe.service" "$probe_unit_path"; else rm -f -- "$probe_unit_path"; fi
        if [ "$probe_timer_existed" -eq 1 ]; then install -m 0644 "$backup_root/castoriceui-protocol-probe.timer" "$probe_timer_path"; else rm -f -- "$probe_timer_path"; fi
        systemctl daemon-reload || true
        if [ "$probe_timer_was_enabled" -eq 1 ]; then systemctl enable --now castoriceui-protocol-probe.timer || true; else systemctl disable --now castoriceui-protocol-probe.timer || true; fi
        if [ "$database_backed_up" -eq 1 ] && [ -n "$database_path" ]; then
            systemctl stop castoriceui-backend || true
            python3 - "$backup_root/state.db" "$database_path" <<'PY' || true
import sqlite3, sys
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
with target:
    source.backup(target)
source.close()
target.close()
PY
        fi
        systemctl restart castoriceui-backend || true
    fi
    cleanup
    echo "Backup retained at $backup_root" >&2
    exit "$status"
}
trap rollback EXIT HUP INT TERM

python3 - "$archive" "$staging" <<'PY'
import pathlib, sys, tarfile
archive = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).resolve()
with tarfile.open(archive, "r:gz") as bundle:
    members = bundle.getmembers()
    if not members or len(members) > 10_000:
        raise SystemExit("Release archive is empty or has too many entries")
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
            raise SystemExit(f"Unsafe release member: {member.name}")
        target = (destination / pathlib.Path(*path.parts)).resolve()
        if target != destination and destination not in target.parents:
            raise SystemExit(f"Release member escapes staging: {member.name}")
    bundle.extractall(destination)
PY

release_source="$staging/CastoriceUI-v$version"
[ -f "$release_source/server/run.py" ] || { echo "Staged backend is incomplete." >&2; exit 1; }
[ -f "$release_source/frontend/index.html" ] || { echo "Staged frontend is incomplete." >&2; exit 1; }
[ -f "$release_source/deploy/castoriceui-backend.service" ] || { echo "Staged service unit is missing." >&2; exit 1; }
[ -f "$release_source/deploy/castoriceui-protocol-probe.service" ] || { echo "Staged protocol probe unit is missing." >&2; exit 1; }
[ -f "$release_source/deploy/castoriceui-protocol-probe.timer" ] || { echo "Staged protocol probe timer is missing." >&2; exit 1; }

python3 -m compileall -q "$release_source/server"
python3 -m unittest discover -s "$release_source/server/tests" -p 'test_*.py' -v
python3 "$release_source/server/preflight.py" --config "$config_path" > "$backup_root/preflight.json"
python3 - "$release_source" <<'PY'
import pathlib, shutil, sys
root = pathlib.Path(sys.argv[1]).resolve()
for cache in list(root.rglob("__pycache__")):
    if cache.is_dir() and root in cache.parents:
        shutil.rmtree(cache)
for bytecode in list(root.rglob("*.py[co]")):
    if bytecode.is_file() and root in bytecode.parents:
        bytecode.unlink()
PY

database_path=$(python3 - "$config_path" <<'PY'
import json, sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["database_path"])
PY
)
case "$database_path" in /*) ;; *) echo "database_path must be absolute." >&2; exit 1 ;; esac

cp -a "$config_path" "$backup_root/config.json"
[ ! -f "$unit_path" ] || cp -a "$unit_path" "$backup_root/castoriceui-backend.service"
if [ -f "$probe_unit_path" ]; then cp -a "$probe_unit_path" "$backup_root/castoriceui-protocol-probe.service"; probe_unit_existed=1; fi
if [ -f "$probe_timer_path" ]; then cp -a "$probe_timer_path" "$backup_root/castoriceui-protocol-probe.timer"; probe_timer_existed=1; fi
if systemctl is-enabled --quiet castoriceui-protocol-probe.timer 2>/dev/null; then probe_timer_was_enabled=1; fi
if [ -f "$database_path" ]; then
    python3 - "$database_path" "$backup_root/state.db" <<'PY'
import sqlite3, sys
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
with target:
    source.backup(target)
source.close()
target.close()
PY
    database_backed_up=1
fi
printf '%s\n' "$old_backend" > "$backup_root/previous-backend-target.txt"
printf '%s\n' "$old_frontend" > "$backup_root/previous-frontend-target.txt"

cp -a "$release_source" "$backend_release"
install -d -m 0755 "$frontend_release"
cp -a "$release_source/frontend/." "$frontend_release/"
chown -R root:root "$backend_release" "$frontend_release"

switched=1
install -m 0644 "$backend_release/deploy/castoriceui-backend.service" "$unit_path"
install -m 0644 "$backend_release/deploy/castoriceui-protocol-probe.service" "$probe_unit_path"
install -m 0644 "$backend_release/deploy/castoriceui-protocol-probe.timer" "$probe_timer_path"
ln -sfn "$backend_release" "$backend_link.next"
mv -Tf "$backend_link.next" "$backend_link"
ln -sfn "$frontend_release" "$frontend_link.next"
mv -Tf "$frontend_link.next" "$frontend_link"

systemctl daemon-reload
systemctl enable --now castoriceui-protocol-probe.timer
systemctl start castoriceui-protocol-probe.service
systemctl restart castoriceui-backend
nginx -t
python3 - "$version" <<'PY'
import json, sys, time, urllib.request
expected = sys.argv[1]
last = None
for _ in range(20):
    try:
        with urllib.request.urlopen("http://127.0.0.1:18080/api/v2/health", timeout=2) as response:
            last = json.load(response)
        if last.get("status") == "ok" and last.get("version") == expected:
            break
    except Exception as error:
        last = str(error)
    time.sleep(0.5)
else:
    raise SystemExit(f"Loopback health check failed: {last}")
PY

switched=0
trap - EXIT HUP INT TERM
cleanup
echo "CastoriceUI v$version deployed. Backup retained at $backup_root"
