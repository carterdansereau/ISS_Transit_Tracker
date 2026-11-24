"""Interpolate NASA's J2000 position and velocity pairs for Skyfield."""
import numpy as np
from skyfield.constants import AU_KM, DAY_S
from skyfield.vectorlib import VectorFunction
from skyfield.searchlib import find_discrete
from datetime import datetime, timezone


class Trajectory(VectorFunction):
    center = 399
    target = -125544
    target_name = "ISS (NASA)"

    def __init__(self, data):
        rows = np.array(data["rows"])
        self.times = rows[:, 0] / 1000
        self.position = rows[:, 1:4]
        self.velocity = rows[:, 4:]
        self.start, self.end = [datetime.fromtimestamp(t, timezone.utc) for t in self.times[[0, -1]]]
        self.metadata = dict(epoch=data["epoch"], source=data["source"],
                             start=self.start.isoformat(), end=self.end.isoformat())

    def _at(self, t):
        # UTC seconds relative to the first vector, preserving fractional seconds.
        seconds = self.times[0] + (t - t.ts.from_datetime(self.start))*DAY_S
        i = np.clip(np.searchsorted(self.times, seconds, side="right")-1, 0, len(self.times)-2)
        dt = np.expand_dims(self.times[i+1]-self.times[i], -1)
        u = np.expand_dims(seconds-self.times[i], -1)/dt
        p, q = self.position[i], self.position[i+1]
        v, w = self.velocity[i]*dt, self.velocity[i+1]*dt
        # Cubic Hermite with an acceleration correction that vanishes at both endpoints.
        delta = q-p
        a, b = 3*delta-2*v-w, -2*delta+v+w
        def gravity(pos):
            return -398600.4418*pos/np.linalg.norm(pos, axis=-1, keepdims=True)**3
        c = gravity(p)*dt**2/2-a
        d = gravity(q)*dt**2/2-a-3*b-c
        base = u*u*(1-u)**2
        pos = p+u*(v+u*(a+u*b))+base*(c+u*d)
        vel = (v+u*(2*a+3*u*b)+2*u*(1-u)*(1-2*u)*(c+u*d)+base*d)/dt
        return pos.T/AU_KM, vel.T*DAY_S/AU_KM, None, None

    def find_events(self, site, t0, t1, altitude_degrees=0):
        relative = self-site
        def above(t):
            return relative.at(t).altaz()[0].degrees >= altitude_degrees
        above.step_days = 30/DAY_S
        times, states = find_discrete(t0, t1, above)
        return times, np.where(states, 0, 2)
