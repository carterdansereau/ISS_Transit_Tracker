# Meridian · ISS Transit Tracker

The GitHub Pages build runs the sky chart and transit calculations in your browser. It builds and refreshes the current ISS orbit daily. Dated ISS elements can be pasted into the site's orbit archive and are saved in that browser. The repository's Pages settings must be enabled before the site gets a public URL.

Find the ISS, Sun, Moon, and planets in the sky above an observing site. Move the clock to watch the sky change, follow the ISS across a pass, or search for the moments it crosses the face of the Sun or Moon. The browser interface runs on your own computer.

## Run it

From the repository directory on Windows, with Python 3.11 or newer installed, run

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py serve
```

On macOS or Linux, use `python3 -m venv .venv` and `.venv/bin/python` for the remaining commands. Open [Meridian on localhost](http://127.0.0.1:8000). Use `serve --port 8080` if port 8000 is occupied.

## Explore the sky

1. Select **Greenwich Observatory** and enter your coordinates and elevation, or choose **Use device location**. The chart faces up with north at the top, east on the left, and the zenith in the middle.
2. Choose **Now**, enter a UTC date and time, or drag **Explore the day**. The object list includes bodies below the horizon.
3. Open **Passes & transits** and select a search interval. Choose **View track** for a pass or **View corridor** for a solar or lunar encounter. The corridor view links to the nearest sampled centerline point on OpenStreetMap.
4. To explore history, pick an earlier time. **Orbit archive** lets you jump to a saved orbit, download historical elements for the selected interval, or import an ISS two-line element set. Saved orbits persist across restarts.

The planetary ephemeris ships with the Python dependencies. The server attempts a current ISS orbit refresh at startup. Planetary history and saved ISS orbits remain usable offline. A gap in ISS coverage means that the search lacks a suitable orbit for that interval. Historical transit results are reconstructions from orbital elements and can differ from recorded observations.

**Try a historical transit immediately.** Open **Passes & transits** and choose **Replay a historical solar transit**. The example uses an archived ISS orbit from April 25, 2024 and a site on the predicted path. **Restore my observation** returns to your previous location and time.

## Command line

Print the same sky positions used in the browser for a specified site and time. Longitude is positive east and elevation is in metres.

```powershell
.\.venv\Scripts\python.exe app.py sky --lat 51.4779 --lon -0.0015 --elevation 46 --at 2024-04-25T18:22:37Z
```

See the [observing and data guide](doc/observing.md) for coordinate conventions, source coverage, and timing limits. The [developer guide](doc/development.md) describes the HTTP interface and verification commands.
