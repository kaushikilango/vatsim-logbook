# Multi-User Auth Handoff Plan

## Goal
Add VATSIM Connect login so each user sees only their own logbook, while the live tracker and flight detail pages show all registered users' active flights.

---

## Feasibility: Yes

Everything described is achievable with the existing stack (FastAPI, PostgreSQL, React). No new infrastructure needed. Estimated effort: 2–3 days of focused work.

---

## Auth Provider — VATSIM Connect

VATSIM has an official OAuth2/OpenID Connect provider at `https://auth.vatsim.net`. It is free and open to all developers.

Steps to register:
1. Go to `https://auth.vatsim.net/apps` and create a new application
2. Set the redirect URI to `https://logbook.aeternveritas.com/auth/callback`
3. You will receive a `CLIENT_ID` and `CLIENT_SECRET` — add these to `.env`

The OAuth flow returns the user's VATSIM CID, name, and rating. No password management needed on our side.

---

## Database Changes

Add one new table:

```sql
CREATE TABLE users (
    cid         INTEGER PRIMARY KEY,
    name        TEXT,
    rating      INTEGER,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    last_login  TIMESTAMPTZ
);
```

The `flights` table already has `cid` — no changes needed there.

---

## Backend Changes

### 1. New dependencies
- `httpx` — for OAuth token exchange calls (likely already installed)
- `python-jose` or `PyJWT` — for issuing JWT session tokens
- `itsdangerous` or FastAPI's built-in `OAuth2` — for session cookie signing

### 2. New auth routes (`app/auth.py`)

| Route | Purpose |
|---|---|
| `GET /auth/login` | Redirect user to VATSIM Connect authorize URL |
| `GET /auth/callback` | Exchange code for token, upsert user in DB, issue JWT cookie |
| `POST /auth/logout` | Clear session cookie |
| `GET /auth/me` | Return current user's CID and name (used by frontend) |

### 3. JWT session
- Issue a short-lived JWT (e.g. 7 days) as an `HttpOnly` cookie on callback
- Create a `get_current_user` dependency that reads and validates the cookie
- Inject this dependency into protected routes

### 4. API route changes

| Route | Change |
|---|---|
| `GET /api/flights` | Filter by `cid = current_user.cid` (protected) |
| `GET /api/flights/{id}` | Allow if `cid` matches OR flight belongs to any registered user (public read) |
| `GET /api/live` | No CID filter — returns all active registered users' flights |

### 5. Poller changes
The poller currently tracks one `VATSIM_CID` from `.env`. With multi-user support:
- `VATSIM_CID` in `.env` becomes optional / removed
- On each poll cycle, load the list of registered CIDs from the `users` table
- `_active_flight_id` dict becomes `{ cid: flight_id }` instead of a single value
- This was already identified as the next step before this auth work

---

## Frontend Changes

### 1. Auth state
Add an `AuthContext` (or simple top-level state) that:
- On app load, calls `GET /auth/me` to check if logged in
- Stores `{ cid, name }` or `null`

### 2. Login UI
- Add a "Login with VATSIM" button to the navbar/home page
- Redirect to `GET /auth/login` on click
- On callback, the backend sets the cookie and redirects back to `/`

### 3. Page-level filtering

| Page | Behavior |
|---|---|
| **Logbook** | Show only logged-in user's flights. Redirect to login if not authenticated. |
| **Globe** | Show only logged-in user's flight paths. |
| **Live Tracker** | Show all registered users' active flights (no login required to view). |
| **Flight Detail** | Public — any registered user's flight is viewable. |

---

## Open Questions Before Starting

1. **Who can register?** Anyone with a VATSIM account, or only specific CIDs you invite? (Affects whether signup is open or invite-only.)
2. **Globe public or private?** Should the globe be visible to non-logged-in visitors, or gated?
3. **Live tracker data source:** Currently the poller only tracks your CID. For live tracker to show other users, they need to have logged in at least once (so their CID is in the `users` table) and the poller needs to poll for all registered CIDs.

---

## Suggested Implementation Order

1. Register app on VATSIM Connect, get credentials
2. Add `users` table to DB
3. Build `/auth/login` → `/auth/callback` → JWT cookie flow
4. Add `get_current_user` dependency, protect `/api/flights`
5. Refactor poller to multi-CID (see existing notes on this)
6. Update frontend: `AuthContext`, login button, filter Logbook/Globe by CID
7. Update Live Tracker to show all registered users
