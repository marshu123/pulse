# Pulse

**Uptime monitoring.** Register a URL, Pulse probes it on a schedule, records
response times, and shows you when it broke.

Built to learn the parts of a backend that are easy to skip: a background
worker, time-series data, and deciding what a "correct" statistic means.

![Status](https://img.shields.io/badge/tests-70%20passing-34ba5b) ![Frontend](https://img.shields.io/badge/frontend-57%20tests-34ba5b) ![CI](https://github.com/marshu123/pulse/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-MIT-8b949e)

---

## Try it

| | |
| --- | --- |
| **Live demo** | https://frontend-ruddy-two-24.vercel.app |
| **API** | https://pulse-api-6sts.onrender.com |
| **API docs** | https://pulse-api-6sts.onrender.com/docs |

Create an account, add any public URL, and it is probed immediately. Nothing to
install.

> The API runs on Render's free tier, which sleeps after 15 minutes idle. The
> first request after a quiet period takes about 30 seconds while it wakes up.
> Everything works, it is just slow that once. A paid instance removes the delay.

---

## Why this exists

Most portfolio CRUD apps stop at "posts and comments". This one has the three
things that show up in real interviews and are usually missing:

- **A background worker.** A scheduler probes every active monitor on its own
  interval, with a per-tick time budget so one slow endpoint cannot starve the
  loop.
- **Time-series data.** Checks are rows, not counters, so uptime and latency are
  computed over whatever window you ask for.
- **Decisions about what the numbers mean.** Failed probes are excluded from
  latency averages, because a request that errored has no response time and
  counting its near-zero value makes a slow endpoint look fast.

## Stack

| Layer     | Choice                                    | Why                                                |
| --------- | ----------------------------------------- | -------------------------------------------------- |
| API       | FastAPI, Pydantic, SQLAlchemy 2, JWT      | Typed, async-ready, boring in the right places      |
| Worker    | `asyncio` task on the app lifespan        | Smallest thing that works; see *known limits*       |
| Database  | PostgreSQL, SQLite for local and tests    | Same schema both ways                              |
| Frontend  | React 18, TypeScript (strict), Vite       | No framework beyond React needed for two screens   |
| Charts    | Hand-rolled SVG                           | One line series does not need a charting library   |
| Tests     | pytest, Vitest, Testing Library           | 127 tests, no network access                       |

## Quick start

```bash
git clone https://github.com/marshu123/pulse
cd pulse
cp .env.example .env

# backend
cd backend
python -m venv .venv
source .venv/Scripts/activate      # Windows
# source .venv/bin/activate        # macOS / Linux
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# frontend, in a second terminal
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, create an account, add a URL. It is probed
immediately, then on a schedule.

Interactive API docs: http://localhost:8000/docs

## Tests

```bash
cd backend  && python -m pytest -q      # 70 tests
cd frontend && npm test                 # 57 tests
```

The backend suite never touches the network â€” `probe` is stubbed and the
database is in-memory SQLite with foreign keys switched on so cascades behave
the same way they do in production. The frontend suite mocks `fetch` and asserts
on real rendered output.

Three bugs these tests caught while writing them, kept here because they are the
kind of thing that is easy to get wrong again:

1. **SQLite silently ignores `ON DELETE CASCADE`** unless `PRAGMA foreign_keys=ON`.
   Deleting a monitor left its checks behind. Now set on every connection, in
   `app/db.py`, and in the test engine.
2. **A failed probe was counted in the latency average.** A timeout with 0 ms
   pulled the average down and made a struggling endpoint look healthy.
3. **`204 No Content` cannot have a response body.** FastAPI rejects a route
   that declares one, so the `DELETE` handler has no return annotation.

## Architecture

```
pulse/
â”œâ”€â”€ backend/
â”‚   â”œâ”€â”€ app/
â”‚   â”‚   â”œâ”€â”€ main.py        app factory, CORS, lifespan
â”‚   â”‚   â”œâ”€â”€ config.py      env-driven settings
â”‚   â”‚   â”œâ”€â”€ models.py      User, Monitor, Check
â”‚   â”‚   â”œâ”€â”€ db.py          engine, session, SQLite pragmas
â”‚   â”‚   â”œâ”€â”€ security.py    PBKDF2 hashing, JWT issue/verify
â”‚   â”‚   â”œâ”€â”€ deps.py        current-user dependency
â”‚   â”‚   â”œâ”€â”€ probe.py       one HTTP request -> a Check
â”‚   â”‚   â”œâ”€â”€ scheduler.py   the background loop
â”‚   â”‚   â”œâ”€â”€ stats.py       uptime, percentiles, incidents
â”‚   â”‚   â””â”€â”€ routers/       auth, monitors
â”‚   â””â”€â”€ tests/             70 tests
â”œâ”€â”€ frontend/
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ api.ts         typed client
â”‚       â”œâ”€â”€ format.ts      formatting, tested in isolation
â”‚       â””â”€â”€ pages/         Login, Dashboard, MonitorDetail
â””â”€â”€ .github/workflows/     CI
```

### API

| Method | Path                          | Notes                                   |
| ------ | ----------------------------- | --------------------------------------- |
| POST   | `/api/auth/register`          | 409 if the email is taken               |
| POST   | `/api/auth/login`             | 401 for both wrong password and unknown email |
| GET    | `/api/monitors`               | One summary per monitor, with uptime    |
| POST   | `/api/monitors`               | Probes once immediately                 |
| PATCH  | `/api/monitors/{id}`          | Rename, pause, change interval          |
| DELETE | `/api/monitors/{id}`          | Cascades to checks                      |
| POST   | `/api/monitors/{id}/check`    | Probe now instead of waiting            |
| GET    | `/api/monitors/{id}/series`   | `?window=1h\|6h\|24h\|7d\|30d`          |
| GET    | `/api/health`                 | Used by the container health check      |

Other people's monitors return **404, not 403**, so the API cannot be used to
probe which monitor ids exist.

## Deploying

One click for the backend, using the included Render blueprint:

1. Go to https://render.com/deploy?repo=https://github.com/marshu123/pulse
2. Confirm the plan. Render creates `pulse-api` and a `pulse-db` PostgreSQL
   database, injects `DATABASE_URL`, and generates `JWT_SECRET` for you.
3. When it finishes, set `CORS_ORIGINS` to your frontend origin.

For the frontend:

```bash
cd frontend
npx vercel
```

Set `VITE_API_URL` to the Render API URL, then deploy. `npm run build` produces
a static `dist/` that can go on any static host.

To run the backend in Docker instead:

```bash
docker build -t pulse .
docker run -p 8000:8000 -e JWT_SECRET="$(openssl rand -hex 32)" pulse
```

See [`backend/DEPLOY.md`](backend/DEPLOY.md) for the free-tier caveat: Render
sleeps idle services, which pauses the scheduler.

## Known limits

Things I would change before this handled real traffic:

- **The scheduler runs in-process.** Two replicas means two schedulers writing
  duplicate checks. The fix is a real queue (Celery, RQ) or a single dedicated
  worker process.
- **No rate limiting on auth.** Someone could brute-force a password.
- **No refresh tokens.** Access tokens last a day; a real product would issue
  short-lived tokens plus a rotating refresh token.
- **Uptime is per-check, not weighted by time.** If a monitor is paused for an
  hour that hour silently disappears from the numbers.
- **No email or webhook alerting**, which is the feature most people actually
  want from a monitor.

## Licence

MIT
