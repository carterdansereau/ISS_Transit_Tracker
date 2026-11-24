# Development

`app.py` serves the static browser client and exposes the same calculations through the CLI. `engine.py` computes observer-relative positions, pass tracks, transit contacts, and ground corridors. `data_store.py` manages orbital elements and the packaged planetary kernel. The UI in `static/` uses native browser APIs and requires no JavaScript build step.

The GitHub Pages build uses `npm run build` to bundle `static/browser-api.js` and copy the UI into `dist/`. The build uses Python 3.11+ to validate NASA’s EME2000/UTC OEM and publish its state vectors alongside the app. Pages deploys the dist artifact. Both engines interpolate between adjacent vectors using their actual time spacing. Astronomy Engine and Skyfield transform J2000 positions to local observer coordinates. Historical TLEs use SGP4.

## HTTP interface

Run the service on loopback. Dates use ISO 8601 with an explicit UTC offset. GET site queries accept `lat`, `lon`, `elevation` in metres, and `at`. All POST requests take JSON.

| Method and path | Inputs | Result |
| --- | --- | --- |
| GET /api/sky | Site and time | Object positions and selected orbit metadata |
| GET /api/events | Site, time, hours (1–360), target | Passes, transit contacts, near misses, coverage gaps |
| GET /api/corridor | Site, closest-approach time, target (Sun or Moon) | Sampled centerline and edges |
| GET /api/archive | None | Stored epochs, provenance, and coverage |
| POST /api/refresh | Empty object | Current orbit metadata |
| POST /api/history | start, end | Number of historical elements added |
| POST /api/import | tle | Number of elements added |

The server searches each interval with the nearest valid elements, allowing extra search time around boundaries to resolve event contacts. The instant of closest approach assigns a transit to a search window. The instant of maximum altitude assigns a pass.

Two historical reference checks exercise different parts of the model. A NASA JPL Horizons observer table gives a lunar azimuth of 94.700016° and an airless altitude of −26.481652° at Greenwich (51.4779° N, 0.0015° W, 46 m) on April 25, 2024 at 18:22 UTC. A second check reconstructs the June 25, 2021 solar transit photographed near Nellysford, Virginia, using archived Space-Track elements obtained from SatChecker. NASA identifies the town, so the comparison tests the predicted corridor's proximity to Nellysford. [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) · [NASA observation](https://science.nasa.gov/resource/space-station-transits-the-sun/) · [SatChecker archive](https://satchecker.readthedocs.io/en/latest/tools_data_access.html)

## Verification

Install the dependencies from `requirements.txt`, then run from the repository root using the project virtual environment.

```sh
python -m unittest discover -s tests -v
node --check static/app.js
```

To check the full browser workflow, open the archive, jump to a saved epoch, then open **Passes & transits**. Select a pass and inspect its track at peak altitude. Change the observer and compare the new sky positions. For a coverage-gap check, choose a date inside the planetary ephemeris range and far from any archived ISS orbit.
