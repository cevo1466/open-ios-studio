#!/usr/bin/env python3
"""A tiny Language Server Protocol fake for the Rust session test.

Reads Content-Length framed JSON-RPC from stdin. Answers `initialize` with empty capabilities, then
publishes one diagnostic as a notification. Answers any other request with an empty result and
exits on `shutdown`/`exit` or EOF.
"""
import json
import sys


def read_message(stream):
    headers = {}
    while True:
        line = stream.readline()
        if not line:
            return None
        line = line.decode("ascii").strip()
        if line == "":
            break
        key, _, value = line.partition(":")
        headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    body = stream.read(length)
    return json.loads(body.decode("utf-8"))


def write_message(stream, payload):
    body = json.dumps(payload).encode("utf-8")
    stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    stream.write(body)
    stream.flush()


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    while True:
        msg = read_message(stdin)
        if msg is None:
            return 0
        method = msg.get("method")
        if method == "initialize":
            write_message(stdout, {"jsonrpc": "2.0", "id": msg["id"], "result": {"capabilities": {}}})
            write_message(
                stdout,
                {
                    "jsonrpc": "2.0",
                    "method": "textDocument/publishDiagnostics",
                    "params": {
                        "uri": "file:///tmp/Demo.swift",
                        "diagnostics": [
                            {"range": {"start": {"line": 2, "character": 4}, "end": {"line": 2, "character": 9}}, "severity": 2, "message": "unused variable"}
                        ],
                    },
                },
            )
        elif method == "exit":
            return 0
        elif "id" in msg:
            write_message(stdout, {"jsonrpc": "2.0", "id": msg["id"], "result": None})


if __name__ == "__main__":
    sys.exit(main())
