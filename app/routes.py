import hashlib
import hmac
import json
import logging
import subprocess

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from config import VATSIM_CID, WEBHOOK_SECRET
from db import get_db

_AWC_BASE = "https://aviationweather.gov/api/data"

router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/flights")
async def list_flights(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    departure: str | None = Query(None),
    arrival: str | None = Query(None),
    aircraft: str | None = Query(None),
):
    conditions, params = [], []

    if search:
        params.append(f"%{search.upper()}%")
        conditions.append(f"callsign LIKE ${len(params)}")
    if departure:
        params.append(departure.upper())
        conditions.append(f"departure = ${len(params)}")
    if arrival:
        params.append(arrival.upper())
        conditions.append(f"arrival = ${len(params)}")
    if aircraft:
        params.append(f"%{aircraft.upper()}%")
        conditions.append(f"aircraft_short ILIKE ${len(params)}")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    n = len(params)

    async with get_db() as conn:
        flights = await conn.fetch(
            f"""SELECT id, callsign, departure, arrival, aircraft_short,
                       flight_rules, logon_time, logoff_time,
                       dep_time, arr_time, max_altitude, max_gs
                FROM flights {where}
                ORDER BY logon_time DESC
                LIMIT ${n+1} OFFSET ${n+2}""",
            *params, limit, offset,
        )
        total = await conn.fetchval(f"SELECT COUNT(*) FROM flights {where}", *params)
    return {
        "flights": [dict(r) for r in flights],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/flights/{flight_id}")
async def get_flight(flight_id: int):
    async with get_db() as conn:
        flight = await conn.fetchrow(
            "SELECT * FROM flights WHERE id = $1", flight_id
        )
        if flight is None:
            raise HTTPException(404, "Flight not found")

        positions = await conn.fetch(
            """SELECT timestamp, latitude, longitude, altitude,
                      groundspeed, heading, transponder
               FROM positions
               WHERE flight_id = $1
               ORDER BY timestamp""",
            flight_id,
        )

    result = dict(flight)
    result["positions"] = [dict(p) for p in positions]
    return result


@router.get("/flights/{flight_id}/track")
async def get_track(flight_id: int):
    async with get_db() as conn:
        exists = await conn.fetchval(
            "SELECT id FROM flights WHERE id = $1", flight_id
        )
        if not exists:
            raise HTTPException(404, "Flight not found")

        rows = await conn.fetch(
            """SELECT timestamp, latitude, longitude, altitude,
                      groundspeed, heading
               FROM positions
               WHERE flight_id = $1
               ORDER BY timestamp""",
            flight_id,
        )

    if not rows:
        raise HTTPException(404, "No track data for this flight")
    return [dict(r) for r in rows]


@router.get("/globe")
async def globe_data():
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT f.id, f.callsign, f.departure, f.arrival,
                      f.logon_time, f.logoff_time, f.max_altitude, f.aircraft_short,
                      COALESCE(fp.latitude,  da.latitude)  AS start_lat,
                      COALESCE(fp.longitude, da.longitude) AS start_lng,
                      COALESCE(lp.latitude,  aa.latitude)  AS end_lat,
                      COALESCE(lp.longitude, aa.longitude) AS end_lng
               FROM flights f
               LEFT JOIN positions fp ON fp.id = (
                   SELECT id FROM positions WHERE flight_id = f.id
                   ORDER BY timestamp ASC LIMIT 1
               )
               LEFT JOIN positions lp ON lp.id = (
                   SELECT id FROM positions WHERE flight_id = f.id
                   ORDER BY timestamp DESC LIMIT 1
               )
               LEFT JOIN airports da ON da.icao = f.departure
               LEFT JOIN airports aa ON aa.icao = f.arrival
               ORDER BY f.logon_time DESC"""
        )
    return [dict(r) for r in rows]


@router.get("/stats")
async def stats():
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT
               COUNT(*)                                                          AS total_flights,
               COUNT(logoff_time)                                                AS completed_flights,
               ROUND(CAST(SUM(
                   CASE WHEN COALESCE(arr_time, logoff_time) IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (
                       COALESCE(arr_time, logoff_time)::timestamptz
                       - COALESCE(dep_time, logon_time)::timestamptz
                   )) / 3600.0
                   ELSE 0 END
               ) AS numeric), 1)                                                 AS total_hours,
               COALESCE(MAX(max_altitude), 0)                                   AS highest_altitude,
               COALESCE(MAX(max_gs), 0)                                         AS highest_gs,
               COUNT(DISTINCT departure)                                         AS unique_departures,
               COUNT(DISTINCT arrival)                                           AS unique_arrivals
               FROM flights
               WHERE cid = $1""",
            VATSIM_CID,
        )
    return dict(row)


@router.get("/stats/monthly")
async def stats_monthly():
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT TO_CHAR(logon_time, 'YYYY-MM') AS month,
                      COUNT(*) AS flights,
                      ROUND(CAST(SUM(
                          CASE WHEN COALESCE(arr_time, logoff_time) IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (
                              COALESCE(arr_time, logoff_time)::timestamptz
                              - COALESCE(dep_time, logon_time)::timestamptz
                          )) / 3600.0
                          ELSE 0 END
                      ) AS numeric), 1) AS hours
               FROM flights
               WHERE cid = $1
               GROUP BY month
               ORDER BY month ASC""",
            VATSIM_CID,
        )
    return [dict(r) for r in rows]


@router.get("/stats/airports")
async def stats_airports():
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT icao, COUNT(*) AS visits
               FROM (
                   SELECT departure AS icao FROM flights WHERE cid = $1 AND departure IS NOT NULL
                   UNION ALL
                   SELECT arrival AS icao FROM flights WHERE cid = $1 AND arrival IS NOT NULL
               ) a
               GROUP BY icao ORDER BY visits DESC LIMIT 15""",
            VATSIM_CID,
        )
    return [dict(r) for r in rows]


@router.get("/stats/aircraft")
async def stats_aircraft():
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT COALESCE(aircraft_short, 'Unknown') AS aircraft, COUNT(*) AS count
               FROM flights WHERE cid = $1
               GROUP BY aircraft_short ORDER BY count DESC LIMIT 12""",
            VATSIM_CID,
        )
    return [dict(r) for r in rows]


@router.get("/stats/routes")
async def stats_routes():
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT departure, arrival, COUNT(*) AS count,
                      ROUND(CAST(AVG(
                          CASE WHEN COALESCE(arr_time, logoff_time) IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (
                              COALESCE(arr_time, logoff_time)::timestamptz
                              - COALESCE(dep_time, logon_time)::timestamptz
                          )) / 3600.0
                          ELSE NULL END
                      ) AS numeric), 1) AS avg_hours
               FROM flights
               WHERE cid = $1 AND departure IS NOT NULL AND arrival IS NOT NULL
               GROUP BY departure, arrival ORDER BY count DESC LIMIT 15""",
            VATSIM_CID,
        )
    return [dict(r) for r in rows]


@router.get("/airports/{icao}")
async def get_airport(icao: str):
    async with get_db() as conn:
        row = await conn.fetchrow(
            "SELECT icao, name, latitude, longitude FROM airports WHERE icao = $1",
            icao.upper(),
        )
    if row is None:
        raise HTTPException(404, "Airport not found")
    return dict(row)


@router.get("/airports/{icao}/runways")
async def get_runways(icao: str):
    async with get_db() as conn:
        rows = await conn.fetch(
            """SELECT le_ident, he_ident, length_ft, width_ft, surface,
                      lighted, le_lat, le_lon, le_heading,
                      he_lat, he_lon, he_heading
               FROM runways WHERE airport_icao = $1
               ORDER BY length_ft DESC NULLS LAST""",
            icao.upper(),
        )
    return [dict(r) for r in rows]


@router.get("/status")
async def status():
    from poller.poller import _active_flight_id, _last_timestamp
    return {
        "online": _active_flight_id is not None,
        "flight_id": _active_flight_id,
        "last_poll": _last_timestamp,
    }


@router.post("/webhook/deploy")
async def webhook_deploy(request: Request):
    body = await request.body()

    if WEBHOOK_SECRET:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(403, "Invalid signature")

    payload = request.headers.get("X-GitHub-Event", "")
    if payload == "ping":
        return {"status": "pong"}

    data = json.loads(body)
    if data.get("ref") != "refs/heads/master":
        return {"status": "ignored", "ref": data.get("ref")}

    # Detach from the current process group so the script survives the restart
    subprocess.Popen(
        ["/home/kilango/Git/vatsim-logbook/deploy/deploy.sh"],
        start_new_session=True,
    )
    log.info("Deploy triggered via GitHub webhook")
    return {"status": "deploying"}


@router.get("/weather/metar/{icao}")
async def weather_metar(icao: str):
    url = f"{_AWC_BASE}/metar?format=json&hours=3&ids={icao.upper()}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            data = r.json()
    except Exception:
        return JSONResponse([])
    return JSONResponse(data if isinstance(data, list) else [])


@router.get("/weather/taf/{icao}")
async def weather_taf(icao: str):
    url = f"{_AWC_BASE}/taf?format=json&ids={icao.upper()}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            data = r.json()
    except Exception:
        return JSONResponse([])
    return JSONResponse(data if isinstance(data, list) else [])
