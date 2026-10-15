"""Inspect the panel's own server block, without logging site contents."""
import shlex
import re
from urllib.parse import urlsplit


def directives(text: str):
    lexer = shlex.shlex(text, posix=True, punctuation_chars="{};")
    lexer.whitespace_split = True
    tokens = []
    for token in lexer:
        tokens.extend(token if token and set(token) <= set("{};") else [token])
    root = []
    stack = [root]
    header = []
    for token in tokens:
        if token == "{":
            children = []
            stack[-1].append((header, children))
            stack.append(children)
            header = []
        elif token == "}":
            if header or len(stack) == 1:
                raise ValueError("Invalid Nginx block")
            stack.pop()
        elif token == ";":
            stack[-1].append((header, None))
            header = []
        else:
            header.append(token)
    if header or len(stack) != 1:
        raise ValueError("Incomplete Nginx block")
    return root


def walk(nodes):
    for header, children in nodes:
        yield header, children
        if children is not None:
            yield from walk(children)


def panel_site(text: str, host: str, port: int) -> dict:
    try:
        nodes = directives(text)
        servers = [children for header, children in walk(nodes) if header == ["server"] and children is not None
                   and any(line == ["root", "/var/www/castorice-ui/current"] for line, _ in walk(children))]
        if len(servers) != 1:
            raise ValueError("Expected one panel server block")
        server = servers[0]
        direct = [line for line, children in server if children is None]
        names = [name for line in direct if line and line[0] == 'server_name' for name in line[1:]]
        if not names or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]*', name) for name in names):
            raise ValueError("Panel requires explicit verifiable server names")
        listens = [line for line in direct if line and line[0] == "listen"]
        if not listens or any("ssl" not in line for line in listens):
            raise ValueError("Panel listeners must all require TLS")
        certificates = [line[1] for line in direct if len(line) == 2 and line[0] == "ssl_certificate"]
        keys = [line[1] for line in direct if len(line) == 2 and line[0] == "ssl_certificate_key"]
        if len(certificates) != 1 or len(keys) != 1 or any("$" in value or not value.startswith("/") for value in certificates + keys):
            raise ValueError("Expected explicit panel certificate and key")
        upstreams = [line[1] for line, _ in walk(server) if len(line) == 2 and line[0] == "proxy_pass"]
        if len(upstreams) != 1:
            raise ValueError("Expected one panel API upstream")
        upstream = urlsplit(upstreams[0])
        if upstream.scheme != "http" or upstream.hostname != host or upstream.port != port or upstream.path or upstream.username or upstream.password or upstream.query or upstream.fragment:
            raise ValueError("Panel API upstream does not match protected configuration")
        api_blocks = [children for line, children in server if line and line[0] == "location" and "/api/" in line and children is not None]
        if len(api_blocks) != 1 or not any(line == ["proxy_pass", upstreams[0]] for line, _ in walk(api_blocks[0])):
            raise ValueError("Panel API location is missing or ambiguous")
        return {"ok": True, "certificate": certificates[0], "key": keys[0], "serverNames": names, "reason": "validated"}
    except (ValueError, IndexError):
        return {"ok": False, "reason": "Panel TLS block, certificate or matching loopback API upstream is missing or ambiguous"}
