# Contributing — Local Setup Guide

## Prerequisites

Install these before starting:

- **Python 3.12+** — https://python.org
- **Node.js 18+** — https://nodejs.org
- **PostgreSQL 16+** — https://postgresql.org/download
- **Git**

---

## 1. Clone the repo

```bash
git clone https://github.com/kaushikilango/vatsim-logbook.git
cd vatsim-logbook
```

---

## 2. Create the database

```bash
createdb vatsim_logbook
```

---

## 3. Set up environment variables

Create a `.env` file in the project root:

```
VATSIM_CID=<your VATSIM CID>
DATABASE_URL=postgresql:///vatsim_logbook
```

Replace `<your VATSIM CID>` with your own VATSIM CID. The app will track your flights.

---

## 4. Install Python dependencies

```bash
pip install -r requirements.txt
```

---

## 5. Load the seed data (airports + runways)

```bash
psql vatsim_logbook < seed.sql
```

This loads ~43k airports and ~15k runways. Takes about 10–20 seconds.

---

## 6. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

---

## 7. Run the app

```bash
python3 run.py
```

The app will be available at **http://localhost:7777**

On first run it creates the `flights` and `positions` tables automatically.

---

## 8. Frontend dev mode (optional)

If you're actively working on the frontend, run Vite's dev server instead of using the built files:

```bash
# Terminal 1 — backend
python3 run.py

# Terminal 2 — frontend dev server (hot reload)
cd frontend
npm run dev
```

Then open **http://localhost:5173** instead. The dev server proxies API and WebSocket calls to the backend on port 7777.

---

## Workflow

- Branch off `master` for your changes: `git checkout -b your-feature`
- Open a pull request into `master` when ready
- After a PR is merged, changes are deployed to `https://logbook.aeternveritas.com`

---

## Notes

- Never commit your `.env` file — it is gitignored
- The `flights` and `positions` tables in your local DB contain your own flights only
- The `seed.sql` file contains only airport/runway reference data (no personal flight data)
