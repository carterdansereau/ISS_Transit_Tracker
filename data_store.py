"""Durable local ISS orbit archive and packaged JPL planetary ephemeris."""

import json
import math
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import cached_property
from importlib.resources import files
from pathlib import Path
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sgp4.io import verify_checksum
from skyfield.api import EarthSatellite, Loader, load_file

UTC = timezone.utc
MAX_AGE_DAYS = 3
SAMPLE = Path(__file__).parent / 'data' / 'iss-2024-04-25.tle'
SAMPLE_TIME = '2024-04-25T18:22:37Z'
MAX_BYTES = 2_000_000


class OrbitUnavailable(ValueError):
    """No suitable orbit exists for the requested date."""


def utc(time):
    if time.tzinfo is None or time.utcoffset() is None:
        raise ValueError('Please include a UTC offset with the date.')
    return time.astimezone(UTC)


def iso(time):
    return utc(time).isoformat().replace('+00:00', 'Z')


def download(url):
    request = Request(url, headers={'User-Agent': 'ISS-Transit-Tracker/1.0'})
    with urlopen(request, timeout=12) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('The orbital data response exceeded the size limit.')
    return data.decode('utf-8-sig')


class Store:
    def __init__(self, cache_dir=None):
        self.directory = Path(cache_dir or os.getenv('ISS_CACHE_DIR') or Path.home() / '.iss-transit-tracker')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.database = self.directory / 'orbits.sqlite3'
        self.timescale = Loader(str(self.directory)).timescale(builtin=True)
        self.refresh_lock = Lock()
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS orbits(epoch REAL PRIMARY KEY, first TEXT, second TEXT, source TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value REAL)')
        self.import_tle(SAMPLE.read_text(encoding='ascii'), 'IAU CPS SatChecker / CelesTrak')
        historical = SAMPLE.with_name('iss-2021-06-25.tle')
        self.import_tle(historical.read_text(encoding='ascii'), 'IAU CPS SatChecker / Space-Track')

    @cached_property
    def _kernel(self):
        return load_file(str(files('skyfield_data').joinpath('data', 'de421.bsp')))

    def ephemeris(self):
        return self._kernel

    def import_tle(self, text, source='Imported TLE'):
        """Validate the entire batch, then atomically add previously unseen epochs."""
        if len(text) > MAX_BYTES:
            raise ValueError('Please split the TLE file into batches under 2 MB.')
        rows = []
        first = None
        for line in text.splitlines():
            line = line.rstrip()
            if not line:
                continue
            if not line.startswith(('1 ', '2 ')):
                if first:
                    raise ValueError('Missing second TLE line.')
                continue
            if len(line) != 69 or line[2:7] != '25544' or not line[-1].isdigit():
                raise ValueError('Expected a complete 69-character ISS (25544) TLE line with a checksum.')
            verify_checksum(line)
            if line.startswith('1 ') and first is None:
                first = line
            elif line.startswith('2 ') and first:
                satellite = EarthSatellite(first, line, 'ISS', self.timescale)
                model = satellite.model
                if model.error or not (0 < model.no_kozai < 1 and 0 <= model.ecco < 1 and 0 <= model.inclo <= math.pi):
                    raise ValueError('Invalid ISS orbital elements.')
                epoch = satellite.epoch.utc_datetime().timestamp()
                rows.append((epoch, first, line, source))
                first = None
            else:
                raise ValueError('Expected a matching pair of ISS TLE lines.')
        if first or not rows:
            raise ValueError('Provide one or more complete ISS TLE pairs.')
        with closing(sqlite3.connect(self.database)) as db, db:
            db.executemany('INSERT OR IGNORE INTO orbits VALUES(?,?,?,?)', rows)
            return db.total_changes

    def orbits(self):
        with closing(sqlite3.connect(self.database)) as db:
            rows = db.execute('SELECT epoch, source FROM orbits ORDER BY epoch').fetchall()
        return [dict(epoch=iso(datetime.fromtimestamp(t, UTC)), source=s) for t, s in rows]

    def orbit_at(self, time):
        timestamp = utc(time).timestamp()
        with closing(sqlite3.connect(self.database)) as db:
            row = db.execute('SELECT * FROM orbits ORDER BY abs(epoch - ?), epoch LIMIT 1', (timestamp,)).fetchone()
        if not row or abs(row[0] - timestamp) > MAX_AGE_DAYS * 86400:
            raise OrbitUnavailable('No archived ISS orbit within three days. Load historical orbits, import a TLE, or refresh current data.')
        t, first, second, source = row
        return EarthSatellite(first, second, 'ISS', self.timescale), dict(
            epoch=iso(datetime.fromtimestamp(t, UTC)), source=source, age_days=abs(t-timestamp)/86400)

    def coverage(self):
        rows = self.orbits()
        spans = []
        margin = timedelta(days=MAX_AGE_DAYS)
        for row in rows:
            t = datetime.fromisoformat(row['epoch'].replace('Z', '+00:00'))
            if spans and t-margin <= spans[-1][1]:
                spans[-1][1] = t+margin
            else:
                spans.append([t-margin, t+margin])
        return dict(count=len(rows), first_epoch=rows[0]['epoch'], last_epoch=rows[-1]['epoch'],
                    intervals=[dict(start=iso(a), end=iso(b)) for a,b in spans], example_time=SAMPLE_TIME)

    def refresh(self):
        now = datetime.now(UTC)
        with self.refresh_lock, closing(sqlite3.connect(self.database)) as db, db:
            row = db.execute("SELECT value FROM state WHERE key='refresh'").fetchone()
            if row and now.timestamp() - row[0] < 7200:
                return self.orbit_at(now)[1]
            attempt = db.execute("SELECT value FROM state WHERE key='attempt'").fetchone()
            if attempt and now.timestamp() - attempt[0] < 120:
                try:
                    return self.orbit_at(now)[1]
                except OrbitUnavailable as error:
                    raise RuntimeError('The orbit providers are unavailable. Retry in two minutes.') from error
            db.execute("INSERT OR REPLACE INTO state VALUES('attempt',?)", (now.timestamp(),))
            db.commit()
            try:
                self.import_tle(download('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE'), 'CelesTrak GP')
                _, metadata = self.orbit_at(now)
            except (OSError, ValueError) as current_error:
                try:
                    self.fetch_history(now - timedelta(days=MAX_AGE_DAYS), now)
                    _, metadata = self.orbit_at(now)
                except (OSError, ValueError) as archive_error:
                    raise RuntimeError(f'ISS refresh failed. CelesTrak: {current_error}. SatChecker: {archive_error}.') from archive_error
            db.execute("INSERT OR REPLACE INTO state VALUES('refresh',?)", (now.timestamp(),))
            return metadata

    def fetch_history(self, start, end):
        start, end = utc(start), utc(end)
        if not timedelta(0) < end-start <= timedelta(days=10):
            raise ValueError('Choose an archive interval of up to 10 days.')
        query = urlencode(dict(id='25544', id_type='catalog',
                               start_date_jd=start.timestamp()/86400+2440587.5,
                               end_date_jd=end.timestamp()/86400+2440587.5))
        payload = json.loads(download('https://satchecker.cps.iau.org/tools/get-tle-data/?'+query))
        records = payload.get('data') if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ValueError('SatChecker returned an unreadable orbit archive.')
        if not records:
            return 0
        try:
            text = '\n'.join(line for r in records for line in (r['tle_line1'], r['tle_line2']))
        except (KeyError, TypeError) as error:
            raise ValueError('SatChecker returned incomplete TLE records.') from error
        return self.import_tle(text, 'IAU CPS SatChecker')
