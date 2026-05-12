import asyncpg
from config import DATABASE_URL

_pool: asyncpg.Pool | None = None

_CREATE_AIRPORTS = """
CREATE TABLE IF NOT EXISTS airports (
    icao      TEXT PRIMARY KEY,
    name      TEXT,
    latitude  DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    type      TEXT
)
"""

_CREATE_FLIGHTS = """
CREATE TABLE IF NOT EXISTS flights (
    id             SERIAL PRIMARY KEY,
    cid            INTEGER NOT NULL,
    callsign       TEXT NOT NULL,
    server         TEXT,
    pilot_rating   INTEGER,
    logon_time     TEXT NOT NULL,
    logoff_time    TEXT,
    departure      TEXT,
    arrival        TEXT,
    alternate      TEXT,
    aircraft       TEXT,
    aircraft_short TEXT,
    flight_rules   TEXT,
    route          TEXT,
    planned_alt    INTEGER,
    cruise_tas     INTEGER,
    max_altitude   INTEGER DEFAULT 0,
    max_gs         INTEGER DEFAULT 0,
    dep_time       TEXT,
    arr_time       TEXT
)
"""

_CREATE_POSITIONS = """
CREATE TABLE IF NOT EXISTS positions (
    id          SERIAL PRIMARY KEY,
    flight_id   INTEGER NOT NULL REFERENCES flights(id),
    timestamp   TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    altitude    INTEGER NOT NULL,
    groundspeed INTEGER NOT NULL,
    heading     INTEGER NOT NULL,
    transponder TEXT,
    qnh_mb      INTEGER,
    UNIQUE(flight_id, timestamp)
)
"""

_CREATE_RUNWAYS = """
CREATE TABLE IF NOT EXISTS runways (
    id           SERIAL PRIMARY KEY,
    airport_icao TEXT NOT NULL,
    le_ident     TEXT,
    he_ident     TEXT,
    length_ft    INTEGER,
    width_ft     INTEGER,
    surface      TEXT,
    lighted      BOOLEAN,
    closed       BOOLEAN,
    le_lat       DOUBLE PRECISION,
    le_lon       DOUBLE PRECISION,
    le_heading   DOUBLE PRECISION,
    he_lat       DOUBLE PRECISION,
    he_lon       DOUBLE PRECISION,
    he_heading   DOUBLE PRECISION
)
"""

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_positions_flight ON positions(flight_id)",
    "CREATE INDEX IF NOT EXISTS idx_flights_cid ON flights(cid)",
    "CREATE INDEX IF NOT EXISTS idx_flights_logon ON flights(logon_time DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runways_airport ON runways(airport_icao)",
]


async def init_db():
    global _pool
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    async with _pool.acquire() as conn:
        await conn.execute(_CREATE_AIRPORTS)
        await conn.execute(_CREATE_FLIGHTS)
        await conn.execute(_CREATE_POSITIONS)
        await conn.execute(_CREATE_RUNWAYS)
        for idx in _CREATE_INDEXES:
            await conn.execute(idx)


def get_pool() -> asyncpg.Pool:
    return _pool


def get_db():
    """Return a connection context manager from the pool."""
    return _pool.acquire()
