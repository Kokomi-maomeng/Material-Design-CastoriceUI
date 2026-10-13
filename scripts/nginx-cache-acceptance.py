"""Reproduce stale HTML validators, then test the installer fix with real Nginx.

Uses an isolated temporary prefix and an ephemeral loopback port. Never loads
host Nginx configuration or changes a running service.
"""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cache_qa_installer', ROOT / 'deploy/install_release.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)
with tempfile.TemporaryDirectory(prefix='castorice-cache-qa-') as folder:
    base = Path(folder); base.chmod(0o755)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    html = base / 'index.html'; old = b'<html>old-build-001</html>'; new = b'<html>new-build-002</html>'
    assert len(old) == len(new)
    html.write_bytes(old); os.utime(html, (946684800, 946684800))
    legacy = f'''pid {base}/nginx.pid;
error_log {base}/error.log;
events {{}}
http {{
 access_log off;
 server {{
  listen 127.0.0.1:{port};
  root {base};
  index index.html;
  location / {{
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /index.html;
  }}
 }}
}}
'''
    config = base / 'nginx.conf'; config.write_text(legacy)
    process = subprocess.Popen(['nginx', '-p', str(base), '-c', str(config), '-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def get(headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=2); c.request('GET', '/', headers=headers or {})
        r = c.getresponse(); result = r.status, r.read(), dict(r.getheaders()); c.close(); return result
    try:
        for _ in range(100):
            try:
                initial = get(); break
            except OSError:
                if process.poll() is not None: raise RuntimeError('isolated-nginx-start-failed')
                time.sleep(.03)
        else: raise RuntimeError('isolated-nginx-timeout')
        assert initial[0] == 200 and initial[1] == old
        validators = {'If-None-Match': initial[2]['ETag'], 'If-Modified-Since': initial[2]['Last-Modified']}
        html.write_bytes(new); os.utime(html, (946684800, 946684800))
        assert get(validators)[0] == 304, 'legacy-collision-not-reproduced'
        config.write_text(installer.protect_html_updates(legacy)); process.send_signal(signal.SIGHUP)
        # Graceful reload briefly has old and new workers accepting requests.
        # Require every legacy validator path to observe the new policy.
        for _ in range(100):
            responses = [get(headers) for headers in (validators, {'If-Modified-Since': initial[2]['Last-Modified']}, {'If-None-Match': initial[2]['ETag']})]
            if all(r[0] == 200 and r[1] == new and r[2].get('Cache-Control') == 'no-store' and 'ETag' not in r[2] for r in responses):
                break
            time.sleep(.03)
        else:
            raise AssertionError('old-validators-did-not-observe-upgraded-html-policy')
        print(json.dumps({'legacySameTimeAndLength304Reproduced': True, 'upgradeReturnsNewHtmlWithOldValidators': True, 'lastModifiedAloneReturns200': True, 'etagAloneReturns200': True}))
    finally:
        process.send_signal(signal.SIGQUIT)
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=3)
