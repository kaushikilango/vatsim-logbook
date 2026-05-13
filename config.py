import os
from dotenv import load_dotenv

load_dotenv()

try:
    VATSIM_CID = int(os.environ["VATSIM_CID"])
except (KeyError, ValueError):
    raise SystemExit("Set VATSIM_CID=<your CID> in .env or environment")

VATSIM_API_URL = "https://data.vatsim.net/v3/vatsim-data.json"
POLL_INTERVAL = 15  # seconds — VATSIM feed updates every ~15s

# PostgreSQL — set DATABASE_URL in .env, e.g.:
# DATABASE_URL=postgresql://kilango@localhost/vatsim_logbook
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql:///vatsim_logbook")

# GitHub webhook secret — set WEBHOOK_SECRET in .env
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
