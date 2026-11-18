#!/usr/bin/env python3
"""Run a Python file inside the open Blender through the MCP for Blender addon (localhost:9876).

    python3 tools/blender/bl.py tools/blender/make_weapons.py [args...]

Blender must be open with the addon's server started. Arguments are passed to the script as `ARGS`.
"""
import json, os, socket, sys

def run(code: str, timeout=600):
    s = socket.create_connection(("localhost", int(os.environ.get("BLENDER_PORT", 9876))), timeout=timeout)
    s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except ValueError:
            continue
    return json.loads(buf.decode())

if __name__ == "__main__":
    path = os.path.abspath(sys.argv[1])
    code = f"ARGS = {sys.argv[2:]!r}\n__file__ = {path!r}\n" + open(path).read() if len(sys.argv) > 1 and os.path.exists(path) else sys.argv[1]
    out = run(code)
    if out.get("status") == "error":
        msg = out.get("message", "")
        try:
            print(json.loads(msg)["traceback"], file=sys.stderr)
        except Exception:
            print(msg, file=sys.stderr)
        sys.exit(1)
    print(out.get("result", {}).get("result", ""), end="")
