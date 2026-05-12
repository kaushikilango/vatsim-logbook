"""
Import runway data from OurAirports (public domain).
Source: https://davidmegginson.github.io/ourairports-data/runways.csv

Columns used:
  airport_ident, le_ident, he_ident, length_ft, width_ft, surface,
  lighted, closed,
  le_latitude_deg, le_longitude_deg, le_heading_degT,
  he_latitude_deg, he_longitude_deg, he_heading_degT

Usage:
  python import_runways.py
"""

import asyncio
import csv
import io
import urllib.request

import asyncpg
from config import DATABASE_URL

URL = "https://davidmegginson.github.io/ourairports-data/runways.csv"


def safe_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def safe_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


async def main():
    print(f"Downloading {URL} …")
    with urllib.request.urlopen(URL, timeout=30) as r:
        raw = r.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(raw))
    rows = list(reader)
    print(f"  {len(rows):,} runway records")

    # Filter out rows with no endpoint coordinates
    valid = [
        r for r in rows
        if r.get("le_latitude_deg") and r.get("le_longitude_deg")
        and r.get("he_latitude_deg") and r.get("he_longitude_deg")
        and not r.get("closed", "0") == "1"
    ]
    print(f"  {len(valid):,} usable (open, with coordinates)")

    conn = await asyncpg.connect(DATABASE_URL)

    await conn.execute("DELETE FROM runways")

    await conn.executemany(
        """INSERT INTO runways
           (airport_icao, le_ident, he_ident, length_ft, width_ft, surface,
            lighted, closed, le_lat, le_lon, le_heading, he_lat, he_lon, he_heading)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)""",
        [
            (
                r["airport_ident"].strip(),
                r.get("le_ident", "").strip() or None,
                r.get("he_ident", "").strip() or None,
                safe_int(r.get("length_ft")),
                safe_int(r.get("width_ft")),
                r.get("surface", "").strip() or None,
                r.get("lighted", "0") == "1",
                r.get("closed",  "0") == "1",
                safe_float(r.get("le_latitude_deg")),
                safe_float(r.get("le_longitude_deg")),
                safe_float(r.get("le_heading_degT")),
                safe_float(r.get("he_latitude_deg")),
                safe_float(r.get("he_longitude_deg")),
                safe_float(r.get("he_heading_degT")),
            )
            for r in valid
        ],
    )

    count = await conn.fetchval("SELECT COUNT(*) FROM runways")
    print(f"Imported {count:,} runways into DB.")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
