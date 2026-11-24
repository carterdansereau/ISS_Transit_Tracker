"""Topocentric sky positions, ISS pass searches and sea-level transit corridors."""
from datetime import timedelta
from pathlib import Path
from importlib.resources import files
import numpy as np
from skyfield.api import EarthSatellite, load, load_file, wgs84
from skyfield.framelib import itrs


BODIES = {"Sun": "sun", "Moon": "moon", **{
    name: name.lower() + " barycenter"
    for name in ("Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune")
}}
RADII_KM = {"Sun": 695700., "Moon": 1737.4}
ISS_RADIUS_KM = .055  # Approximate outer silhouette, attitude independent.


def stamp(dt):
    return dt.isoformat(timespec="milliseconds")


def minimum(f, a, b):
    """Golden-section refinement to 2 milliseconds."""
    ratio = (5**.5 - 1) / 2
    c, d = b-ratio*(b-a), a+ratio*(b-a)
    fc, fd = f(c), f(d)
    while b-a > .002:
        if fc < fd:
            b, d, fd = d, c, fc
            c = b-ratio*(b-a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a+ratio*(b-a)
            fd = f(d)
    return (a+b)/2


def contact(f, outside, inside):
    while abs(outside-inside) > .002:
        mid = (outside+inside)/2
        if f(mid) <= 0:
            inside = mid
        else:
            outside = mid
    return (outside+inside)/2


class Engine:
    def __init__(self, data_dir=None, store=None):
        self.ts = store.timescale if store else load.timescale()
        self.eph = store.ephemeris() if store else load_file(str(
            (Path(data_dir) if data_dir else files("skyfield_data") / "data") / "de421.bsp"))
        self.earth = self.eph["earth"]

    def satellite(self, orbit):
        if isinstance(orbit, EarthSatellite):
            return orbit
        return EarthSatellite(*orbit[-2:], "ISS", self.ts)

    def positions(self, lat, lon, elevation_m, at, orbit=None):
        site = wgs84.latlon(lat, lon, elevation_m)
        t = self.ts.from_datetime(at)
        observer = (self.earth + site).at(t)
        vectors = [(name, observer.observe(self.eph[key]).apparent()) for name, key in BODIES.items()]
        if orbit is not None:
            vectors.insert(0, ("ISS", (self.satellite(orbit)-site).at(t)))
        rows = []
        for name, vector in vectors:
            altitude, azimuth, distance = vector.altaz()
            rows.append(dict(name=name, alt=float(altitude.degrees), az=float(azimuth.degrees),
                             distance_km=float(distance.km)))
        return rows

    def sky_path(self, lat, lon, elevation_m, at, target, orbit):
        site = wgs84.latlon(lat, lon, elevation_m)
        if target == "ISS" and orbit is None:
            return []
        step = 10 if target == "ISS" else 300
        times = self.ts.from_datetimes([at + timedelta(seconds=i * step) for i in range(73)])
        if target == "ISS":
            vector = (self.satellite(orbit) - site).at(times)
        elif target in BODIES:
            vector = (self.earth + site).at(times).observe(self.eph[BODIES[target]]).apparent()
        else:
            raise ValueError("Unknown sky object.")
        alt, az, _ = vector.altaz()
        return [dict(alt=a, az=z) for a, z in zip(alt.degrees.tolist(), az.degrees.tolist())]

    def events(self, lat, lon, elevation_m, start, end, orbit):
        result = dict(passes=[], transits=[], near_misses=[])
        site = wgs84.latlon(lat, lon, elevation_m)
        sat = self.satellite(orbit)
        relative = sat-site
        t0, t1 = self.ts.from_datetime(start), self.ts.from_datetime(end)
        times, codes = sat.find_events(site, t0, t1, altitude_degrees=0)
        rise = start if relative.at(t0).altaz()[0].degrees >= 0 else None
        peak = None
        for dt, code in [*zip(times.utc_datetime(), codes), (end, 2)]:
            if code == 0:
                rise, peak = dt, None
            elif code == 1:
                peak = dt
            elif rise is not None and dt > rise:
                self._pass(result, site, relative, rise, peak, dt)
                rise, peak = None, None
        return result

    def _pass(self, result, site, relative, rise, peak, setting):
        span = (setting-rise).total_seconds()
        seconds = np.linspace(0, span, max(3, int(np.ceil(span/4))+1))
        base = self.ts.from_datetime(rise)
        times = base + seconds/86400
        sat = relative.at(times)
        alt, az, unused = sat.altaz()
        if peak is None:
            peak = rise + timedelta(seconds=float(seconds[np.argmax(alt.degrees)]))
        palt, paz, _ = relative.at(self.ts.from_datetime(peak)).altaz()
        track = [dict(time=stamp(rise+timedelta(seconds=float(s))), alt=float(a), az=float(z))
                 for s, a, z in zip(seconds, alt.degrees, az.degrees)]
        result["passes"].append(dict(rise=stamp(rise), peak=stamp(peak), set=stamp(setting),
                                     peak_alt=float(palt.degrees), peak_az=float(paz.degrees), track=track))
        observer = self.earth + site
        observer_samples = observer.at(times)
        for name in RADII_KM:
            body = self.eph[BODIES[name]]
            objects = observer_samples.observe(body).apparent()
            sep = sat.separation_from(objects).degrees
            # A pass moves smoothly. Bracket local minima before testing for disk
            # overlap so a subsecond transit between samples is still detected.
            candidates = np.where((sep[1:-1] <= sep[:-2]) & (sep[1:-1] <= sep[2:])
                                  & (sep[1:-1] < 10))[0]+1
            for i in candidates:
                def geometry(s):
                    t = base + s/86400
                    obj = observer.at(t).observe(body).apparent()
                    station = relative.at(t)
                    angle = station.separation_from(obj).degrees
                    radius = np.rad2deg(np.arcsin(RADII_KM[name]/obj.distance().km)
                                        + np.arcsin(ISS_RADIUS_KM/station.distance().km))
                    return float(angle), float(angle-radius)
                def margin(s):
                    return geometry(s)[1]
                m = minimum(margin, seconds[i-1], seconds[i+1])
                separation, gap = geometry(m)
                if separation > 3:
                    continue
                t = base + m/86400
                h, z, _ = observer.at(t).observe(body).apparent().altaz()
                if h.degrees < 0:
                    continue
                def when(s):
                    return stamp(rise+timedelta(seconds=float(s)))
                row = dict(target=name, peak=when(m), alt=float(h.degrees), az=float(z.degrees),
                           separation_deg=separation)
                if gap <= 0:
                    entry = contact(margin, 0., m) if margin(0.) > 0 else 0.
                    exit_time = contact(margin, span, m) if margin(span) > 0 else span
                    row.update(entry=when(entry), exit=when(exit_time), duration_s=exit_time-entry)
                    result["transits"].append(row)
                else:
                    result["near_misses"].append(row)

    def corridor(self, at, target, orbit):
        """Intersect a shadow cone with WGS84 over one minute around the event."""
        if target not in RADII_KM:
            raise ValueError("Choose Sun or Moon")
        ts = self.ts.from_datetime(at)
        seconds = np.arange(-30,31,1)
        times = ts + seconds/86400
        station = self.satellite(orbit).at(times).frame_xyz(itrs).km.T
        body = self.earth.at(times).observe(self.eph[BODIES[target]]).apparent().frame_xyz(itrs).km.T
        rays = station-body
        directions = rays / np.linalg.norm(rays, axis=1)[:,None]
        axes = np.array([6378.137, 6378.137, 6356.752314245])
        def intersect(origin, direction):
            o, d = origin/axes, direction/axes
            a, b, c = d@d, o@d, o@o-1
            disc = b*b-a*c
            if disc < 0 or b >= 0:
                return None
            hit = origin + direction*((-b-np.sqrt(disc))/a)
            normal = hit/(axes**2)
            return (float(np.rad2deg(np.arctan2(normal[2], np.hypot(*normal[:2])))),
                    float(np.rad2deg(np.arctan2(normal[1], normal[0]))))
        points = []
        velocities = np.gradient(station,axis=0)
        for s, origin, axis, ray, velocity in zip(seconds, station, directions, rays, velocities):
            center = intersect(origin, axis)
            if center is None:
                continue
            across = np.cross(axis, velocity)
            across /= np.linalg.norm(across)
            tilt = across * (RADII_KM[target]/np.linalg.norm(ray))
            left = intersect(origin+across*ISS_RADIUS_KM, axis+tilt)
            right = intersect(origin-across*ISS_RADIUS_KM, axis-tilt)
            if left and right:
                points.append(dict(time=stamp(at+timedelta(seconds=int(s))), lat=center[0], lon=center[1],
                                   left_lat=left[0], left_lon=left[1], right_lat=right[0], right_lon=right[1]))
        return points
