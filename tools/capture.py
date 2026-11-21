#!/usr/bin/env python3
"""Capture the game's screenshots from shots.json with headless Chromium (Playwright).

Serves game/ over a local static HTTP server, opens each ?shot=... scene, waits for
window.__shotReady, and writes the JPEG into screenshots/. Deterministic: the same seed
gives the same frame.
"""
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "game"
SHOTS = ROOT / "screenshots"
SHOTS_JSON = ROOT / "shots.json"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(GAME), **kwargs)

    def log_message(self, format, *args):  # noqa: A002
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve():
    httpd = Server(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port


def main():
    specs = json.loads(SHOTS_JSON.read_text())
    SHOTS.mkdir(exist_ok=True)
    httpd, port = serve()
    base = f"http://127.0.0.1:{port}/index.html"
    made = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        page = browser.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: errors.append(f"console:{msg.type}:{msg.text}") if msg.type == "error" else None)
        for spec in specs:
            name = spec["name"]
            query = spec.get("query", "")
            url = base + query
            page.goto(url, wait_until="load")
            try:
                page.wait_for_function("window.__shotReady === true", timeout=15000)
            except Exception as exc:  # noqa: BLE001
                print(f"WARN {name}: __shotReady not set: {exc}", file=sys.stderr)
            page.wait_for_timeout(250)
            out = SHOTS / name
            page.screenshot(path=str(out), type="jpeg", quality=88)
            made.append((name, out.stat().st_size))
        browser.close()
    httpd.shutdown()
    for name, size in made:
        print(f"wrote {name} {size} B")
    if errors:
        print("PAGE ERRORS:", file=sys.stderr)
        for err in errors[:20]:
            print(" ", err, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
