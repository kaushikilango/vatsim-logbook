import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Awaitable

from config import VATSIM_CID, POLL_INTERVAL
from db import get_db
from poller.client import fetch_vatsim_data

log = logging.getLogger(__name__)

_last_timestamp: str | None = None
_active_flight_id: int | None = None
_ws_broadcast: Callable[[dict], Awaitable[None]] | None = None


def set_broadcast(fn: Callable[[dict], Awaitable[None]]):
    global _ws_broadcast
    _ws_broadcast = fn


async def restore_state():
    """On server restart, find any flight left open in the DB and resume it."""
    global _active_flight_id
    async with get_db() as conn:
        row = await conn.fetchrow(
            """SELECT id FROM flights
               WHERE cid = $1 AND logoff_time IS NULL
               ORDER BY logon_time DESC LIMIT 1""",
            VATSIM_CID,
        )
    if row:
        _active_flight_id = row["id"]
        log.info(f"Restored active flight_id={_active_flight_id}")


async def poll_once():
    global _last_timestamp, _active_flight_id

    data = await fetch_vatsim_data()
    ts = data["general"]["update_timestamp"]
    if ts == _last_timestamp:
        return
    _last_timestamp = ts

    me = next((p for p in data["pilots"] if p["cid"] == VATSIM_CID), None)

    async with get_db() as conn:
        if me:
            _active_flight_id = await _ensure_flight(conn, me)
            await _insert_position(conn, _active_flight_id, me, ts)
            await _update_stats(conn, _active_flight_id, me)
            if _ws_broadcast:
                await _ws_broadcast({
                    "type": "position",
                    "flight_id": _active_flight_id,
                    "callsign": me["callsign"],
                    "lat": me["latitude"],
                    "lng": me["longitude"],
                    "altitude": me["altitude"],
                    "groundspeed": me["groundspeed"],
                    "heading": me["heading"],
                    "timestamp": ts,
                })
        elif _active_flight_id is not None:
            await _close_flight(conn, _active_flight_id)
            log.info(f"Flight {_active_flight_id} closed (pilot went offline)")
            _active_flight_id = None
            if _ws_broadcast:
                await _ws_broadcast({"type": "offline"})


async def _close_flight(conn, flight_id: int):
    row = await conn.fetchrow(
        "SELECT MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts FROM positions WHERE flight_id = $1",
        flight_id,
    )
    if row and row["last_ts"]:
        dep_t  = row["first_ts"]
        arr_t  = row["last_ts"]
        logoff = arr_t
    else:
        dep_t  = None
        arr_t  = None
        logoff = datetime.now(timezone.utc).isoformat()
    await conn.execute(
        """UPDATE flights
           SET logoff_time = $1, dep_time = $2, arr_time = $3
           WHERE id = $4 AND logoff_time IS NULL""",
        logoff, dep_t, arr_t, flight_id,
    )


async def _ensure_flight(conn, pilot: dict) -> int:
    global _active_flight_id
    logon = pilot["logon_time"]

    if _active_flight_id is not None:
        row = await conn.fetchrow(
            "SELECT id FROM flights WHERE id = $1 AND logon_time = $2",
            _active_flight_id, logon,
        )
        if row:
            return _active_flight_id
        await _close_flight(conn, _active_flight_id)
        log.info(f"Auto-closed stale flight {_active_flight_id} (new logon detected)")
        _active_flight_id = None

    fp = pilot.get("flight_plan") or {}
    row = await conn.fetchrow(
        """INSERT INTO flights
           (cid, callsign, server, pilot_rating, logon_time,
            departure, arrival, alternate, aircraft, aircraft_short,
            flight_rules, route, planned_alt, cruise_tas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id""",
        pilot["cid"], pilot["callsign"], pilot.get("server"),
        pilot.get("pilot_rating"), logon,
        fp.get("departure"), fp.get("arrival"), fp.get("alternate"),
        fp.get("aircraft"), fp.get("aircraft_short"),
        fp.get("flight_rules"), fp.get("route"),
        _safe_int(fp.get("altitude")), _safe_int(fp.get("cruise_tas")),
    )
    fid = row["id"]
    log.info(
        f"New flight id={fid} {pilot['callsign']} "
        f"{fp.get('departure', '?')}→{fp.get('arrival', '?')}"
    )
    return fid


async def _insert_position(conn, flight_id: int, pilot: dict, ts: str):
    await conn.execute(
        """INSERT INTO positions
           (flight_id, timestamp, latitude, longitude, altitude,
            groundspeed, heading, transponder, qnh_mb)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (flight_id, timestamp) DO NOTHING""",
        flight_id, ts,
        pilot["latitude"], pilot["longitude"], pilot["altitude"],
        pilot["groundspeed"], pilot["heading"],
        pilot.get("transponder"), pilot.get("qnh_mb"),
    )
    # Record first position timestamp as departure time
    await conn.execute(
        "UPDATE flights SET dep_time = $1 WHERE id = $2 AND dep_time IS NULL",
        ts, flight_id,
    )


async def _update_stats(conn, flight_id: int, pilot: dict):
    await conn.execute(
        """UPDATE flights
           SET max_altitude = GREATEST(max_altitude, $1),
               max_gs       = GREATEST(max_gs, $2)
           WHERE id = $3""",
        pilot["altitude"], pilot["groundspeed"], flight_id,
    )


def _safe_int(val):
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


async def run_poller():
    log.info(f"Poller started — CID={VATSIM_CID}, interval={POLL_INTERVAL}s")
    await restore_state()
    while True:
        try:
            await poll_once()
        except Exception as e:
            log.error(f"Poll error: {e}", exc_info=True)
        await asyncio.sleep(POLL_INTERVAL)
