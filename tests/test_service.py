from datetime import timedelta
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

from app import MAX_AGE_DAYS, Tracker, instant, windows
from engine import Engine


class HistoryTests(unittest.TestCase):
    def test_photographed_nellysford_event(self):
        # Space-Track element set from SatChecker, 2021-06-25 13:19 UTC.
        orbit = ["1 25544U 98067A   21176.55543682 -.00003415  00000-0 -54431-4 0  9991",
                 "2 25544  51.6457 301.3375 0002062  98.4178   3.0356 15.48721305289898"]
        engine = Engine()
        events = engine.events(37.89, -78.87, 200, instant("2021-06-25T16:20Z"),
                               instant("2021-06-25T16:45Z"), orbit)
        event = next(e for e in events["near_misses"] if e["target"] == "Sun")
        self.assertLess(event["separation_deg"], 0.5)
        path = engine.corridor(instant(event["peak"]), "Sun", orbit)
        # NASA gives the town, not the photographer's precise position.
        self.assertTrue(any(abs(p["lat"]-37.89) < .07 and
                            abs(p["lon"]+78.87) < .07 for p in path))

    def test_archived_solar_crossing_and_corridor(self):
        from data_store import Store

        with TemporaryDirectory() as cache:
            tracker = Tracker.__new__(Tracker)
            tracker.store = Store(cache_dir=cache)
            tracker.engine = Engine(store=tracker.store)
            # Independently intersect the ISS-to-Sun line with the WGS84
            # ellipsoid at 13:46 UTC to obtain this observer.
            args = dict(lat=48.98489, lon=-93.13602, elevation=0,
                        hours=1, at="2024-04-25T13:45:00Z")
            events = tracker.query("/api/events", args)
            event = next(e for e in events["transits"] if e["target"] == "Sun")
            dt = instant(event["peak"]) - instant("2024-04-25T13:46:00Z")
            self.assertLess(abs(dt.total_seconds()), 0.2)
            self.assertLess(instant(event["entry"]), instant(event["exit"]))
            path = tracker.query("/api/corridor", {**args, "at": event["peak"], "target": "Sun"})
            self.assertTrue(any(abs(p["lat"]-args["lat"]) < 0.01 and
                                abs(p["lon"]-args["lon"]) < 0.02 for p in path["points"]))

    def test_historical_moon_against_jpl_horizons(self):
        # JPL Horizons observer table, target 301, quantity 4, airless,
        # site -0.0015 E, 51.4779 N, 0.046 km, DE441 reference.
        positions = Engine().positions(51.4779, -0.0015, 46,
                                       instant("2024-04-25T18:22:00Z"), None)
        moon = next(p for p in positions if p["name"] == "Moon")
        self.assertAlmostEqual(moon["alt"], -26.481652, delta=0.003)
        self.assertAlmostEqual(moon["az"], 94.700016, delta=0.003)

    def test_archive_window_includes_gap_and_epoch_change(self):
        start = instant("2024-04-01T00:00:00Z")
        day = timedelta(days=1)
        age = MAX_AGE_DAYS * day
        dates = [start, start + day, start + day + 3*age]
        end = dates[-1] + day
        parts = windows(start, end, [{"epoch": d.isoformat()} for d in dates])
        self.assertIn((dates[1]+age, dates[2]-age), parts)
        self.assertEqual(parts[0], (start, start+day/2))
        self.assertEqual(parts[-1][-1], end)

    def test_datetime_requires_offset(self):
        with self.assertRaisesRegex(ValueError, "offset"):
            instant("2024-04-01T12:00:00")

    def test_orbit_gap_preserves_non_iss_sky_and_reports_unsearched_time(self):
        from data_store import OrbitUnavailable

        tracker = Tracker.__new__(Tracker)
        tracker.store, tracker.engine = Mock(), Mock()
        tracker.store.orbit_at.side_effect = OrbitUnavailable("No orbit")
        tracker.store.orbits.return_value = []
        tracker.engine.positions.return_value = [{"name": "Moon", "alt": 15, "az": 60}]
        query = dict(lat=43, lon=-73, at="1970-01-01T04:00:00Z", hours=6)
        sky = tracker.query("/api/sky", query)
        self.assertIsNone(sky["orbit"])
        self.assertEqual(sky["positions"][0]["name"], "Moon")
        events = tracker.query("/api/events", query)
        self.assertEqual(len(events["gaps"]), 1)
        self.assertEqual(instant(events["gaps"][0]["end"]), instant("1970-01-01T10:00:00Z"))
        tracker.engine.events.assert_not_called()
