#!/usr/bin/env python3
"""Generate a reviewable TLS site; never enable it or reload Nginx."""
import argparse
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from castoriceui.config import AppConfig
from castoriceui.nginx_site import panel_site


def render_site(host: str, port: int, certificate: str, key: str, backend_host: str, backend_port: int, *, http_redirect: bool = True) -> str:
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?", host) or any(not 1 <= len(label) <= 63 for label in host.split('.')):
        raise ValueError("Invalid panel hostname")
    if type(port) is not int or not 1 <= port <= 65535 or port == 80:
        raise ValueError("Invalid panel TLS port")
    if any(not value.startswith('/') or not re.fullmatch(r"/[A-Za-z0-9_./-]+", value) for value in (certificate, key)):
        raise ValueError("Use absolute certificate paths without shell or Nginx variables")
    template = Path(__file__).with_name('nginx.conf.example').read_text(encoding='utf-8')
    template = template.replace('panel.example.com', host)
    template = template.replace(f'/etc/letsencrypt/live/{host}/fullchain.pem', certificate).replace(f'/etc/letsencrypt/live/{host}/privkey.pem', key)
    template = template.replace('listen 443 ssl', f'listen {port} ssl').replace('listen [::]:443 ssl', f'listen [::]:{port} ssl')
    authority = '$host' + (f':{port}' if port != 443 else '')
    template = template.replace('https://$host$request_uri', f'https://{authority}$request_uri')
    if not http_redirect:
        template = re.sub(r'server\s*\{\s*listen 80;[^{}]*\}\s*', '', template, count=1)
    address = f'[{backend_host}]' if ':' in backend_host else backend_host
    template = template.replace('http://127.0.0.1:18080', f'http://{address}:{backend_port}')
    if not panel_site(template, backend_host, backend_port)['ok']:
        raise ValueError("Generated site validation failed")
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='/etc/castoriceui/config.json')
    parser.add_argument('--host', required=True)
    parser.add_argument('--port', type=int, default=443)
    parser.add_argument('--certificate', required=True)
    parser.add_argument('--key', required=True)
    parser.add_argument('--no-http-redirect', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    config = AppConfig.load(args.config)
    text = render_site(args.host, args.port, args.certificate, args.key, config.listen_host, config.listen_port, http_redirect=not args.no_http_redirect)
    with args.output.open('x', encoding='utf-8') as handle:
        handle.write(text)
    print(json.dumps({'generated': True, 'tlsPort': args.port, 'httpRedirect': not args.no_http_redirect, 'enabled': False}))


if __name__ == '__main__':
    main()
