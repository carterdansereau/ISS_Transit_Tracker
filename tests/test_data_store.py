import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from unittest.mock import patch

from sgp4.io import fix_checksum

from data_store import SAMPLE, UTC, OrbitUnavailable, Store


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.store = Store(temporary.name)
        self.text = SAMPLE.read_text(encoding='ascii')
        self.when = datetime(2024, 4, 25, 18, 22, 37, tzinfo=UTC)

    def test_offline_ephemeris_and_seed(self):
        self.assertIn('earth', self.store.ephemeris())
        satellite, metadata = self.store.orbit_at(self.when)
        self.assertEqual(satellite.model.satnum, 25544)
        self.assertLess(metadata['age_days'], .001)
        with self.assertRaises(OrbitUnavailable):
            self.store.orbit_at(self.when + timedelta(days=5))

    def test_import_atomic_and_concurrent(self):
        _, first, second = self.text.splitlines()
        updated = fix_checksum(first.replace('24116.', '24117.')) + '\n' + second
        with self.assertRaises(ValueError):
            self.store.import_tle(updated + '\n' + first)
        self.assertEqual(self.store.coverage()['count'], 2)
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(self.store.import_tle, [updated] * 3))
        self.assertEqual(sum(results), 1)
        self.assertEqual(len(self.store.orbits()), 3)

    def test_nearby_orbit_and_provenance(self):
        _, first, second = self.text.splitlines()
        first = fix_checksum(first.replace('24116.', '24118.'))
        payload = {'data': [{'tle_line1': first, 'tle_line2': second}]}
        with patch('data_store.download', return_value=json.dumps(payload)) as request:
            self.assertEqual(self.store.fetch_history(self.when, self.when + timedelta(days=3)), 1)
        self.assertIn('start_date_jd=', request.call_args.args[0])
        self.assertEqual(self.store.orbit_at(self.when + timedelta(days=2))[1]['source'], 'IAU CPS SatChecker')
        self.assertEqual(len(self.store.coverage()['intervals']), 2)

    def test_nasa_forecast_is_cached_and_bounded(self):
        text = """OBJECT_ID = 1998-067-A
REF_FRAME = EME2000
CENTER_NAME = Earth
TIME_SYSTEM = UTC
CREATION_DATE = 2030-01-01T00:00:00
START_TIME = 2030-01-01T00:00:00
STOP_TIME = 2030-01-01T00:04:00
2030-01-01T00:00:00 6700 0 0 0 7.7 0
2030-01-01T00:04:00 6450 1800 0 -2 7.3 0"""
        with patch('data_store.download', return_value=text) as request:
            meta = self.store.refresh()
            self.assertEqual(self.store.refresh(), meta)
            request.assert_called_once()
        reopened = Store(self.store.directory)
        end = datetime.fromisoformat(meta['end'])
        self.assertEqual(reopened.orbit_at(end)[1], meta)
        with self.assertRaises(OrbitUnavailable):
            reopened.orbit_at(end + timedelta(seconds=1))

    def test_failures_are_throttled(self):
        with patch('data_store.download', side_effect=OSError('offline')) as request:
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    self.store.refresh()
            self.assertEqual(request.call_count, 1)
