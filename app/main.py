import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from db import init_db
from poller.poller import run_poller, set_broadcast
from .routes import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

log = logging.getLogger(__name__)

_ws_clients: set[WebSocket] = set()

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


async def _broadcast(msg: dict):
    payload = json.dumps(msg)
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    set_broadcast(_broadcast)
    task = asyncio.create_task(run_poller())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="VATSIM Logbook", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    log.info(f"WS client connected ({len(_ws_clients)} total)")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)
        log.info(f"WS client disconnected ({len(_ws_clients)} remaining)")


# Serve the built frontend — must come last so API/WS routes take priority.
# StaticFiles alone returns 404 for SPA deep links (e.g. /flight/408).
# The catch-all below serves the real file if it exists, otherwise index.html
# so React Router can take over.
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

    log.info(f"Serving frontend from {FRONTEND_DIST}")
else:
    log.warning(f"Frontend dist not found at {FRONTEND_DIST} — run `npm run build` in frontend/")
