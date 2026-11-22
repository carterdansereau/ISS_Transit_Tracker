"""Checks on the event classifier and cross-track displacement."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

from engine import Engine


class LunarTransitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()
        cls.orbit = (Path(__file__).resolve().parents[1] / "data" /
                     "iss-2024-04-25.tle").read_text().splitlines()
        cls.at = datetime(2024, 4, 25, 2, 30, tzinfo=timezone.utc)
        cls.point = cls.engine.corridor(cls.at, "Moon", cls.orbit)[30]

    def search(self, fraction):
        c = self.point
        lat = c["lat"] + fraction * (c["left_lat"] - c["lat"])
        lon = c["lon"] + fraction * (c["left_lon"] - c["lon"])
        return self.engine.events(lat, lon, 0, self.at-timedelta(minutes=8),
                                  self.at+timedelta(minutes=8), self.orbit)

    def test_lunar_centerline_and_short_graze(self):
        center = self.search(0)["transits"][0]
        graze = self.search(.98)["transits"][0]
        self.assertEqual(center["target"], "Moon")
        self.assertLess(abs((self.at-datetime.fromisoformat(center["peak"])).total_seconds()), .1)
        self.assertGreater(graze["duration_s"], 0)
        self.assertLess(graze["duration_s"], .5 * center["duration_s"])

    def test_outside_corridor(self):
        events = self.search(1.15)
        self.assertFalse(events["transits"])
        self.assertTrue(any(x["target"] == "Moon" for x in events["near_misses"]))
