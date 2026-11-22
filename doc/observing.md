# Observing and historical coverage

## Choose a site and time

Altitude is the angle above the local horizontal plane. An altitude of 0° lies on the horizon and 90° is overhead. Azimuth runs clockwise from true north through east at 90°. Buildings, terrain, weather, and daylight can affect what you can see. A geometric ISS pass can occur during daylight or while the station is in Earth's shadow.

The date control and timeline use UTC. **Now** follows the current clock. Changing the site can turn a near miss into a crossing. Use the coordinates and elevation of your actual observing spot.

## Working backward in time

The solar-system positions come from JPL DE421, included in the installed skyfield-data package. The file spans approximately 1900–2053. Source coverage near those endpoints depends on the exact date. [Skyfield ephemeris documentation](https://rhodesmill.org/skyfield/planets.html)

For ISS history, set the UTC clock to the beginning of the interval, open **Orbit archive**, and choose **Get historical orbits**. You can also paste a NORAD 25544 TLE from your own saved files. Each successful import adds to the local archive. Choose **View sky** beside a saved epoch to inspect that moment. Search forward from an earlier date to reconstruct passes and transits.

Historical downloads query the IAU CPS SatChecker archive. Availability depends on the date and source. The built-in replay uses the April 25, 2024 element set published in the SatChecker data-access example. By default, Meridian keeps downloaded elements in `~/.iss-transit-tracker/orbits.sqlite3`. Set `ISS_CACHE_DIR` before startup to use a different directory. [SatChecker orbital data access](https://satchecker.readthedocs.io/en/latest/tools_data_access.html)

The epoch is the time the orbit elements describe. Meridian chooses the closest available epoch within three days of the requested instant and splits longer searches when the best orbit changes. The archive can be discontinuous. The events view lists uncovered intervals. **Fetch latest** requests a current element set to extend recent coverage. [CelesTrak GP data](https://celestrak.org/NORAD/documentation/gp-data-formats.php)

## Interpreting a transit

Entry and exit bound the predicted disk crossing. Closest approach is when the angular separation between the station and the target center is smallest. The predicted corridor shows how that geometry shifts across nearby locations. Compare a centerline point with your own site before planning an observation.

The calculation uses a circular 55 m radius for the ISS silhouette and a spherical limb for the target. Near misses include separations up to 3°. The ground corridor follows the WGS84 sea-level ellipsoid. Site-specific contact times include your entered elevation. The model uses an airless horizon.

For a solar transit, secure a purpose-built solar filter over the front of each telescope, camera lens, or binocular objective before pointing it at the Sun. Eclipse glasses alone are unsafe with magnifying optics. [NASA solar viewing guidance](https://science.nasa.gov/eclipses/safety/)

TLE errors and ISS maneuvers can move the predicted path by a significant fraction of the corridor width. The displayed times are numerical estimates. Check again with fresh elements near the event. [Skyfield satellite accuracy notes](https://rhodesmill.org/skyfield/earth-satellites.html)
