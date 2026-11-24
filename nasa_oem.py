"""Read NASA/JSC's Earth-centered EME2000 orbit ephemeris (km and km/s)."""
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from urllib.request import urlopen

URL = "https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt"


def timestamp(value):
    return datetime.fromisoformat(value.rstrip("Z")).replace(tzinfo=timezone.utc).timestamp()


def parse(text):
    header, rows = {}, []
    for line in text.splitlines():
        parts = line.split()
        if not parts or parts[0] == "COMMENT":
            continue
        if len(parts) == 3 and parts[1] == "=":
            header[parts[0]] = parts[2]
        elif parts[0][0].isdigit():
            if len(parts) != 7:
                raise ValueError("Incomplete NASA state vector.")
            row = [round(1000*timestamp(parts[0])), *map(float, parts[1:])]
            if not all(map(math.isfinite, row)) or (rows and not 0 < row[0]-rows[-1][0] <= 240000):
                raise ValueError("Invalid interval in NASA trajectory.")
            rows.append(row)
    expected = dict(OBJECT_ID="1998-067-A", REF_FRAME="EME2000", TIME_SYSTEM="UTC", CENTER_NAME="Earth")
    if any(header.get(k) != v for k, v in expected.items()) or len(rows) < 2:
        raise ValueError("Unsupported NASA trajectory.")
    if rows[0][0] != round(1000*timestamp(header["START_TIME"])) or rows[-1][0] != round(1000*timestamp(header["STOP_TIME"])):
        raise ValueError("Incomplete NASA trajectory coverage.")
    return dict(epoch=header["CREATION_DATE"].rstrip("Z")+"Z", source="NASA/JSC ISS trajectory", rows=rows)


if __name__ == "__main__":
    import sys
    with urlopen(URL, timeout=30) as response:
        data = parse(response.read().decode("utf-8-sig"))
    Path(sys.argv[1]).write_text(json.dumps(data, separators=(",", ":")), encoding="ascii")
