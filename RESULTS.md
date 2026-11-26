# Results

Every number here came from a command run in this repo. Each entry records the command, date, commit and machine.

**Machine (all local runs):** Windows 11 laptop, Intel Core i7-13700H (20 logical CPUs), 15.7 GiB RAM; Docker
Desktop 29.9.3 (Postgres 17 and Redis 8 containers); Node v22.16.0.

## Search latency: caching off vs. warm cache (SPEC §5.1, M4)

Date: 2026-11-26 05:12–05:20 UTC (00:12–00:20 US Eastern, off-peak for NCBI) · Backend code: commit `25903f7`
(the run itself was recorded as `252b77a+uncommitted`, the same backend source before it was committed) ·
Command: `node bench/latency.mjs` · Raw data: [`bench/results/latency-2026-11-26T05-20-16-994Z.json`](bench/results/latency-2026-11-26T05-20-16-994Z.json)

200 fixed queries ([`bench/compounds.txt`](bench/compounds.txt)): 180 common drug names + 20 deliberate misspellings.
Sequential (one at a time), timed by the client around each `GET /api/compounds/search` including the body.
The API ran as `node backend/dist/server.js` on the same machine, with its own database and Redis DB.

| Pass | What it measures | ok / errors | mean | p50 | p95 | Served by (`X-Cache`) | PubChem requests |
|---|---|---|---|---|---|---|---|
| **uncached** | `CACHE_BYPASS=true`: every query goes to PubChem; no Redis/Postgres | 200 / 0 | **2,779.0 ms** | 1,679.1 ms | 6,989.0 ms | miss 200 | 380 (0.68/s) |
| cold | Normal mode, empty caches: miss, then fill Postgres + Redis | 200 / 0 | 3,215.3 ms | 2,093.1 ms | 8,220.2 ms | miss 200 | 560 (0.87/s) |
| **warm-redis** | Same 200 queries again | 200 / 0 | **1.9 ms** | 1.6 ms | 3.3 ms | redis 200 | 0 |
| warm-db | Redis flushed, Postgres kept | 200 / 0 | 195.5 ms | 3.2 ms | 1,296.3 ms | db 180, miss 20 | 20 (0.51/s) |

**Mean latency reduction** (`1 − mean_cached / mean_uncached`):

- **Warm Redis: 99.9%** (2,779.0 ms → 1.9 ms).
- Warm Postgres, found names only: 2,985.1 ms → 3.5 ms (99.9%). The pass as a whole is 93.0% lower; its mean is
  pulled up by the 20 misspellings, which go back to PubChem because "not found" answers are cached only in Redis
  (by design: 10-minute negative cache).

**Checks before trusting a >99% number:**
- Every query returned the same number of results in all four passes, so the cache serves the same answers.
- Exactly the 20 deliberate misspellings were "not found" in every pass.
- The size of the gap is real but has a clear cause: an uncached search waits on PubChem over the internet
  (found names averaged 2,985 ms; the slowest single query took 31.0 s), while a warm search is a local Redis read.
- **Limitation:** client and API were on the same machine, so the cached numbers exclude internet round trips.
  A deployed user also pays their own network latency on top.

Politeness: outbound PubChem traffic stayed under the 4 req/s cap (observed 0.51–0.87 req/s averaged per pass);
total about 960 requests, run once, off-peak.

## Load test (SPEC §5.2, M4)

Date: 2026-11-26 05:21–05:25 UTC · Backend code: commit `25903f7` · k6 v1.8.2 (`grafana/k6:1.8.2`) ·
Command: `docker run --rm -v "<repo>/bench:/bench" -e BASE_URL=http://host.docker.internal:3201 grafana/k6:1.8.2 run /bench/load.js`
· Raw data: [`bench/results/k6-summary-2026-11-26T05-25-46Z.json`](bench/results/k6-summary-2026-11-26T05-25-46Z.json)

API: one Node.js process (`NODE_ENV=production`, `CACHE_ONLY=true`, `LOG_LEVEL=warn`), Redis 8 + Postgres 17 in
Docker, k6 in Docker, all on the same laptop. Queries: random picks from the 180 found names, warmed by the
latency benchmark. **Closed loop with no think time** (each virtual user sends the next request as soon as the
previous one returns), 60 s per step.

| Virtual users | Requests | Requests/s | p50 | p95 | p99 | Error rate |
|---|---|---|---|---|---|---|
| 10 | 158,529 | 2,642 | 3.4 ms | 5.3 ms | 7.7 ms | 0.00% |
| 50 | 116,362 | 1,939 | 23.3 ms | 41.8 ms | 50.7 ms | 0.00% |
| 100 | 102,409 | 1,707 | 57.3 ms | 92.0 ms | 103.2 ms | 0.00% |
| **200** | 105,932 | 1,766 | 101.4 ms | **188.9 ms** | 224.4 ms | **0.00%** |

- Highest step with <1% errors: **200 virtual users, p95 188.9 ms, 0 errors**.
- k6 checks (status 200 and `X-Cache` = redis/db) passed on 100% of 483,235 requests. API `/metrics` afterwards:
  **0 PubChem requests**, 0 cache-only rejections, 483,235 × 2xx.
- Throughput levels off around 1.7–1.9k req/s from 50 VUs up, so the single Node process (and the shared laptop,
  which was also running k6) is the bottleneck; latency grows with queueing rather than errors.
- This measures the API on a laptop, not the free-tier deployment, which has far less CPU.

## Tests and coverage

Date: 2026-11-26 · Branch `feat/m4-benchmarks` at `697b624` (code identical to the run) · run locally; CI runs the
same commands on every PR.

| Suite | Command | Result |
|---|---|---|
| Backend unit | `cd backend && npm test` | 98 passed |
| Backend integration (real Postgres 17 + Redis 8 via Testcontainers, PubChem faked) | `cd backend && npm run test:int` | 10 passed |
| Frontend (Vitest + React Testing Library) | `cd frontend && npm test` | 14 passed |
| End-to-end (Playwright, Chromium; real UI + API + DB + Redis, mock PubChem) | `cd e2e && npx playwright test` | 2 passed |
| **Total** | | **124 tests** |

| Area | Command | Lines | Statements | Branches | Functions |
|---|---|---|---|---|---|
| Backend `src/` (unit + integration; `server.ts` wiring excluded) | `cd backend && npm run test:coverage` | 96.03% (436/454) | 93.71% (492/525) | 86.68% (254/293) | 92.74% (115/124) |
| Frontend `src/` (`main.jsx` bootstrap excluded) | `cd frontend && npm run test:coverage` | 100% (50/50) | 98.24% (56/57) | 100% (38/38) | 94.73% (18/19) |

Later: config validation for connection URLs added 5 backend unit tests (103 unit, 129 total; commit after `248ae2a`).
Earlier record: at `3d9c142` (M3) there were 121 tests (95 backend unit); backend line coverage 96.33%.

No test calls the real PubChem or RapidAPI. CI on PR #1 and on `main` after merge: backend, frontend and Docker image
jobs passed; see the Actions tab for the E2E job.

## Other measurements

- Page weight: background image 14,577,969 B → 236,700 B (−98.4%), commit `630d5da`. Built JS 72.9 kB gzipped.

## Baseline of the original app (M0)

See [docs/AUDIT.md](docs/AUDIT.md#baseline-latency-current-apps-search-call). It measured the old Wikipedia-backed
search, so it is **not** the "before" number for the caching claim above.
