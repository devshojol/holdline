#!/usr/bin/env python3
"""Send one addon command to the open Blender: python3 tools/blender/blcmd.py <type> '<json params>'."""
import json, socket, sys

def send(kind, params=None, timeout=300):
    s = socket.create_connection(("localhost", 9876), timeout=timeout)
    s.sendall(json.dumps({"type": kind, "params": params or {}}).encode())
    buf = b""
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except ValueError:
            pass
    return json.loads(buf.decode())

if __name__ == "__main__":
    print(json.dumps(send(sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}), indent=1)[:3000])
