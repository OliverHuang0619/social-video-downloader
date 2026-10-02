#!/usr/bin/env python3
"""Serve a generated report on localhost."""

from __future__ import annotations

import argparse
import functools
import http.server
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="Use 0 for any free port")
    args = parser.parse_args()
    directory = args.directory.expanduser().resolve()
    if not (directory / "index.html").exists():
        parser.error(f"index.html not found in {directory}")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    host, port = server.server_address
    print(f"http://{host}:{port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
