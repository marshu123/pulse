# Pulse

**Uptime monitoring.** Register a URL, Pulse probes it on a schedule, records
response times, and shows you when it broke.

Built to learn the parts of a backend that are easy to skip: a background
worker, time-series data, and deciding what a "correct" statistic means.

![Status](https://img.shields.io/badge/tests-68%20passing-34ba5b) ![Frontend](https://img.shields.io/badge/frontend-41%20tests-34ba5b) ![CI](https://github.com/marshu123/pulse/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-MIT-8b949e)

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
| Tests     | pytest, Vitest, Testing Library           | 109 tests, no network access                       |

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
cd backend  && python -m pytest -q      # 68 tests
cd frontend && npm test                 # 41 tests
```

The backend suite never touches the network — `probe` is stubbed and the
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
├── backend/
│   ├── app/
│   │   ├── main.py        app factory, CORS, lifespan
│   │   ├── config.py      env-driven settings
│   │   ├── models.py      User, Monitor, Check
│   │   ├── db.py          engine, session, SQLite pragmas
│   │   ├── security.py    PBKDF2 hashing, JWT issue/verify
│   │   ├── deps.py        current-user dependency
│   │   ├── probe.py       one HTTP request -> a Check
│   │   ├── scheduler.py   the background loop
│   │   ├── stats.py       uptime, percentiles, incidents
│   │   └── routers/       auth, monitors
│   └── tests/             68 tests
├── frontend/
│   └── src/
│       ├── api.ts         typed client
│       ├── format.ts      formatting, tested in isolation
│       └── pages/         Login, Dashboard, MonitorDetail
└── .github/workflows/     CI
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

The backend is a single container:

```bash
docker build -t pulse .
docker run -p 8000:8000 -e JWT_SECRET="$(openssl rand -hex 32)" pulse
```

For a real deployment set `DATABASE_URL` to PostgreSQL, `CORS_ORIGINS` to your
frontend origin, and `JWT_SECRET` to something random. The frontend is a static
build (`npm run build` → `dist/`) and can go anywhere; point `VITE_API_URL` at
the API.

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
