import asyncio
import logging

import httpx

from config import VATSIM_API_URL

log = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF = 2  # seconds


async def fetch_vatsim_data() -> dict:
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(VATSIM_API_URL)
                r.raise_for_status()
                return r.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_exc = e
            if attempt < _MAX_RETRIES - 1:
                delay = _BACKOFF * (attempt + 1)
                log.warning(f"VATSIM fetch attempt {attempt + 1} failed: {e} — retrying in {delay}s")
                await asyncio.sleep(delay)
    raise last_exc
