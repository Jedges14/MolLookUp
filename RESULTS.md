# Results

Every number here came from a command run in this repo. Each entry records the command, date, commit and machine.

**Machine (local runs):** Windows 11 Home laptop, 20 logical CPUs, 7.6 GiB memory visible to Docker Desktop
(Docker 29.9.3), Node v22.16.0.

## Tests and coverage (M3)

Date: 2026-11-25 · Branch `feat/m1-backend` at commit **`3d9c142`** (clean working tree), run locally.
CI runs the same commands on every PR; see the Actions tab for the run on GitHub's Ubuntu runners.

| Suite | Command | Result |
|---|---|---|
| Backend unit | `cd backend && npm test` | 95 passed (8 files) |
| Backend integration (real Postgres 17 + Redis 8 via Testcontainers, PubChem faked) | `cd backend && npm run test:int` | 10 passed |
| Frontend (Vitest + React Testing Library) | `cd frontend && npm test` | 14 passed (2 files) |
| End-to-end (Playwright, Chromium; real UI + API + DB + Redis, mock PubChem) | `cd e2e && npx playwright test` | 2 passed |
| **Total** | | **121 tests** |

Coverage (V8):

| Area | Command | Lines | Statements | Branches | Functions |
|---|---|---|---|---|---|
| Backend `src/` (unit + integration; `server.ts` wiring excluded) | `cd backend && npm run test:coverage` | 96.33% (421/437) | 94.26% (477/506) | 87.73% (236/269) | 93.44% (114/122) |
| Frontend `src/` (`main.jsx` bootstrap excluded) | `cd frontend && npm run test:coverage` | 100% (50/50) | 98.24% (56/57) | 100% (38/38) | 94.73% (18/19) |

No test calls the real PubChem or RapidAPI: unit tests inject a fake `fetch`, integration tests replay recorded
fixtures, and the E2E run points the API at `e2e/mock-pubchem.mjs`. The E2E test also fails if the browser requests
any PubChem or RapidAPI URL directly.

## Baseline latency of the original app (M0)

See [docs/AUDIT.md](docs/AUDIT.md#baseline-latency-current-apps-search-call). That measured the old Wikipedia-backed
search, so it is **not** the "before" number for the caching claim.

## Not measured yet

- **Search latency reduction from caching** (resume "[x]%"): SPEC §5 benchmark 1, in M4.
- **Load test** (resume "[N] concurrent users, p95 [x] ms"): SPEC §5 benchmark 2 (k6, `CACHE_ONLY=true`), in M4.
