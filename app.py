"""Local web server and command line interface for the ISS Transit Tracker."""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from time import sleep
from urllib.parse import parse_qs, urlsplit
from urllib.error import URLError

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

from data_store import Store, OrbitUnavailable, MAX_AGE_DAYS
from engine import Engine, RADII_KM

STATIC = Path(__file__).resolve().parent / "static"


def instant(value):
    t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise ValueError("Include the UTC offset in the timestamp.")
    return t.astimezone(timezone.utc)


def number(values, key, low, high, default=None):
    value = values.get(key, default)
    if value is None:
        raise ValueError(f"Missing {key}.")
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{key} must be between {low} and {high}.")
    return value


def windows(start, end, epochs):
    """Split at changes to the nearest valid orbital element set."""
    age = timedelta(days=MAX_AGE_DAYS)
    forecasts = [e for e in epochs if "start" in e]
    dates = (instant(e["epoch"]) for e in epochs if "start" not in e)
    epochs = sorted({t for t in dates if start - age <= t <= end + age})
    cuts = {start, end}
    for forecast in forecasts:
        cuts.update((instant(forecast["start"]), instant(forecast["end"])))
    for i, epoch in enumerate(epochs):
        if i == 0 or epoch - epochs[i-1] > 2 * age:
            cuts.add(epoch - age)
        if i == len(epochs)-1 or epochs[i+1] - epoch > 2 * age:
            cuts.add(epoch + age)
        if i and epoch - epochs[i-1] <= 2 * age:
            cuts.add(epochs[i-1] + (epoch - epochs[i-1])/2)
    edges = sorted(t for t in cuts if start <= t <= end)
    return list(zip(edges, edges[1:]))


class Tracker:
    def __init__(self):
        self.store = Store()
        self.engine = Engine(store=self.store)

    def warm_current_orbit(self):
        try:
            self.store.refresh()
        except (ValueError, RuntimeError, OSError) as error:
            print(f"Live orbit refresh unavailable: {error}", file=sys.stderr)

    def refresh_forecasts(self):
        while True:
            self.warm_current_orbit()
            sleep(6 * 3600)

    def query(self, path, args):
        if path == "/api/archive":
            return {**self.store.coverage(), "orbits": self.store.orbits()}
        lat = number(args, "lat", -90, 90)
        lon = number(args, "lon", -180, 180)
        elevation = number(args, "elevation", -500, 10000, 0)
        at = instant(args["at"])
        site = lat, lon, elevation
        if path in ("/api/sky", "/api/path"):
            try:
                orbit, meta = self.store.orbit_at(at)
            except OrbitUnavailable:
                orbit, meta = None, None
            if path == "/api/path":
                return self.engine.sky_path(*site, at, args["target"], orbit)
            return {"positions": self.engine.positions(*site, at, orbit), "orbit": meta}
        if path == "/api/corridor":
            orbit, meta = self.store.orbit_at(at)
            target = args["target"].title()
            if target not in ("Sun", "Moon"):
                raise ValueError("Select the Sun or Moon.")
            return {"points": self.engine.corridor(at, target, orbit), "orbit": meta}
        if path != "/api/events":
            raise ValueError("Unknown endpoint.")
        end = at + timedelta(hours=number(args, "hours", 1, 360, 24))
        target = args.get("target", "Sun and Moon")
        if target == "Sun and Moon":
            targets = ("Sun", "Moon")
        elif target in RADII_KM:
            targets = (target,)
        else:
            raise ValueError("Unknown transit target.")
        result = {"passes": [], "transits": [], "near_misses": [], "gaps": []}
        for a, b in windows(at, end, self.store.orbits()):
            try:
                orbit, meta = self.store.orbit_at(a + (b-a)/2)
            except OrbitUnavailable:
                result["gaps"].append({"start": a.isoformat(), "end": b.isoformat()})
                continue
            # Padding preserves pass rise/set and transit contacts at window edges.
            pad = timedelta(minutes=15)
            left, right = a-pad, b+pad
            if "start" in meta:
                left, right = max(left, instant(meta["start"])), min(right, instant(meta["end"]))
            found = self.engine.events(*site, left, right, orbit, targets)
            for kind, rows in found.items():
                for row in rows:
                    peak = instant(row["peak"])
                    if a <= peak < b:
                        age = abs((peak - instant(meta["epoch"])).total_seconds()) / 86400
                        result[kind].append({**row, "orbit": {**meta, "age_days": age}})
        return result

    def update(self, path, body):
        if path == "/api/import":
            return {"count": self.store.import_tle(body["tle"])}
        if path == "/api/history":
            return {"count": self.store.fetch_history(instant(body["start"]), instant(body["end"]))}
        if path == "/api/refresh":
            return {"orbit": self.store.refresh()}
        raise ValueError("Unknown endpoint.")


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, content, mime):
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def api(self, callback):
        try:
            payload = callback()
            data = json.dumps(payload, allow_nan=False).encode()
        except (ValueError, KeyError, TypeError, OverflowError) as error:
            self.reply(400, json.dumps({"error": str(error)}).encode(), "application/json")
        except (OSError, URLError, RuntimeError) as error:
            self.reply(503, json.dumps({"error": str(error)}).encode(), "application/json")
        else:
            self.reply(200, data, "application/json")

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path.startswith("/api/"):
            args = {k: v[-1] for k, v in parse_qs(url.query).items()}
            self.api(lambda: self.server.tracker.query(url.path, args))
            return
        assets = {"/": ("index.html", "text/html"), "/index.html": ("index.html", "text/html"),
                  "/horizon.js": ("horizon.js", "text/javascript"),
                  "/app.js": ("app.js", "text/javascript"), "/style.css": ("style.css", "text/css")}
        if url.path not in assets:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        name, mime = assets[url.path]
        self.reply(200, (STATIC/name).read_bytes(), mime + "; charset=utf-8")

    def do_POST(self):
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return

        def update():
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 2_000_000:
                raise ValueError("Send a JSON body under 2 MB.")
            return self.server.tracker.update(self.path, json.loads(self.rfile.read(size)))

        self.api(update)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8000)
    sky = commands.add_parser("sky", help="Print sky positions as JSON")
    for name in ("lat", "lon", "at"):
        sky.add_argument("--"+name, required=True)
    sky.add_argument("--elevation", type=float, default=0)
    args = parser.parse_args()
    tracker = Tracker()
    if args.command == "sky":
        if instant(args.at) >= datetime.now(timezone.utc) and not tracker.store.forecast:
            tracker.warm_current_orbit()
        print(json.dumps(tracker.query("/api/sky", vars(args)), indent=2))
        return
    address = ("127.0.0.1", getattr(args, "port", 8000))
    with ThreadingHTTPServer(address, Handler) as server:
        server.tracker = tracker
        Thread(target=tracker.refresh_forecasts, daemon=True).start()
        print(f"ISS Transit Tracker at http://{address[0]}:{server.server_port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
