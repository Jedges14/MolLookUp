# SPEC: MolLookUp Upgrade

Resume version: **Software Engineering Intern (Full Stack)**, also listed on the AI version · Repo: existing `MolLookUp`

## 1. Goal

Take the existing MolLookUp app (React frontend + SQL) to production quality without rewriting it:

1. A clear backend API layer between the browser and PubChem.
2. A proper caching layer (Redis, plus the existing SQL store as durable storage), with **measured** before/after latency to re-verify the "85% latency reduction" claim.
3. Polite, rate-limited PubChem access with retries.
4. Unit, integration and end-to-end tests; CI; Docker; a deployed public URL.
5. A load test that replaces the unverified "100+ concurrent users" claim with real numbers.

### Resume bullets this project must support

- Built a full-stack web app that retrieves drug structures from the PubChem API and renders them in the browser.
- Cut average search latency by [85]% by caching results in [Redis + PostgreSQL], eliminating redundant API calls. *(Re-measured; update the number to whatever the benchmark shows.)*
- Added [N] tests and a CI pipeline; load-tested at [N] concurrent users with p95 latency of [x] ms.

## 2. Step zero: audit before changing anything

Claude Code must first read the repo and write `docs/AUDIT.md` covering:

- Current structure, frameworks and versions; how it runs; what "SQL" means today (which database, where it lives, the schema).
- Whether there is already a backend. If the React app calls PubChem directly from the browser, note it.
- **Which API it actually calls: PubChem (compound/structure data) or PubMed (literature).** The resume must match reality.
- How the original 85% number was measured, if that can be recovered.
- Bugs, security issues (API keys in the frontend, SQL injection risk), dead code.
- A proposed change list mapped to this spec's milestones.

👤 Jedges reviews AUDIT.md before any code changes.

## 3. Target architecture

```
React (Vite) ──► Backend API ──► Redis (hot cache, TTL)
                     │            └─miss─► PostgreSQL (durable compound store)
                     │                         └─miss─► PubChem PUG-REST (rate-limited client)
                     └──► /metrics, /health
```

**Backend choice.** If the repo already has a backend, keep its language and framework. If not, use **Node.js + TypeScript + Express (or Fastify)**. That adds a different stack from the Java invoice app, which is good for range. Keep the frontend's React code; migrate it to Vite/TypeScript only if the audit shows it's cheap.

**Data flow for `GET /api/compounds/search?q=aspirin`:**
1. Normalize the query (trim, lowercase, collapse whitespace).
2. Redis `GET search:<q>` → hit: return (log `cache=redis`).
3. Miss → Postgres lookup by name/synonym/CID → hit: write to Redis, return (`cache=db`).
4. Miss → PubChem via the rate-limited client → upsert into Postgres → write to Redis → return (`cache=miss`).
5. Negative results (not found) are cached briefly (e.g. 10 min) to prevent repeated misses.

**PubChem client rules.** PubChem asks that scripts make no more than 5 requests per second (commonly cited further limits: 400 per minute, and a 30-second timeout per request). Implement:
- A token bucket at **≤4 requests/second** shared across the server process
- Retry with exponential backoff + jitter on 503 or throttling responses, max 3 attempts
- Respect PubChem's throttling response headers when present
- Request batching where PUG-REST supports it (e.g. multiple CIDs per property request)
- A descriptive User-Agent

**Postgres schema (migrate the existing schema; don't drop data):**
```sql
compounds(cid INT PRIMARY KEY, name TEXT, iupac_name TEXT, formula TEXT, mol_weight NUMERIC,
          canonical_smiles TEXT, inchikey TEXT, xlogp NUMERIC, fetched_at TIMESTAMPTZ)
compound_synonyms(cid INT REFERENCES compounds, synonym TEXT, PRIMARY KEY (cid, synonym))
CREATE INDEX ON compound_synonyms (lower(synonym));
```
Use a migration tool (node-pg-migrate, Knex, Prisma or Drizzle; pick one and stay with it).

**API endpoints:**
```
GET /api/compounds/search?q=     → list of {cid, name, formula, mw}
GET /api/compounds/:cid          → full record
GET /api/compounds/:cid/image    → proxies/caches the PubChem 2D structure PNG (cache-control headers)
GET /health   GET /metrics (request count, cache hit ratio, p50/p95 latency; Prometheus format or JSON)
```
Validate input with Zod; return consistent JSON errors; never let PubChem errors crash the server.

## 4. Testing

- **Unit:** query normalization, cache key logic, rate limiter (fake timers), PubChem response parsing using recorded fixtures.
- **Integration:** the API with real Redis + Postgres via Testcontainers (or docker-compose in CI), PubChem **mocked** (nock/MSW) so tests are deterministic and never hit the real service.
- **Frontend:** Vitest + React Testing Library for the search box, results list and error/empty/loading states.
- **E2E:** Playwright, search "aspirin" → see the structure image and formula.
- Coverage report in CI; record the numbers in RESULTS.md.

## 5. Benchmarks (honest numbers only)

Create `bench/` with a reproducible script and a fixed list of 200 compound names (common drugs, plus 20 deliberate misspellings for not-found cases).

1. **Latency before vs. after caching:** run the 200 queries with (a) caching disabled, which goes straight to PubChem (rate-limited, so slow; run it once, off-peak), and (b) warm cache. Report mean/p50/p95 per mode. The resume's "% reduction" is `1 − mean_cached / mean_uncached`. Note in RESULTS.md how many cache tiers were hit.
2. **Load test with k6** against the deployed or local stack **in cache-only mode** (a flag that returns 503 instead of calling PubChem on a miss) so the test **never sends load to PubChem**. Ramp 10 → 50 → 100 → 200 virtual users over warm-cached queries; report p50/p95 latency, error rate and requests/second at each step, plus the machine/instance size. The resume's "[N] concurrent users with p95 [x] ms" comes from the highest step with <1% errors.

## 6. DevOps

- Dockerfile for the backend (multi-stage, non-root user), frontend built as static files.
- `docker-compose.yml`: api, redis, postgres, plus the frontend dev server.
- GitHub Actions: lint → typecheck → unit + integration tests (with service containers) → build images → (on `main`) deploy.
- Deploy: frontend on Vercel/Netlify; API + Redis + Postgres on Render/Railway/Fly.io (check current free tiers; Upstash is an option for hosted Redis).
- Environment config via `.env` (never committed) and `.env.example`.

## 7. Milestones

**M0, Audit (½–1 day).** `docs/AUDIT.md`; capture a baseline latency measurement of the app as it is now, if it runs.
✅ Jedges approves the change list.

**M1, Backend + PubChem client (2 days).** API skeleton, rate-limited client, search + detail endpoints, Postgres migrations, frontend switched to call the backend only.
✅ App works end to end locally via docker-compose; unit tests for the client and limiter.

**M2, Caching (1 day).** Redis cache-aside, negative caching, cache headers on images, `/metrics` with hit ratio.
✅ Integration tests show the second identical request makes zero PubChem calls.

**M3, Tests + CI (1–2 days).** Integration (mocked PubChem), frontend tests, one Playwright test, CI workflow, coverage.
✅ CI green on a PR; README badge.

**M4, Deploy + benchmarks (1–2 days).** Docker, deployment, `bench/` latency comparison, k6 load test, RESULTS.md, README with architecture diagram + GIF/screenshot.
✅ Public URL; RESULTS.md has both benchmarks with commands, dates and hardware; resume bullets updated with measured numbers.

## 8. Rules for Claude Code

- Don't rewrite the app from scratch; refactor incrementally and keep it working after each milestone.
- Never call the real PubChem API in automated tests, CI or load tests.
- Keep the outbound rate below PubChem's published limit, even in benchmarks.
- Preserve existing data during migrations.
- If the measured latency reduction differs from 85%, report the real number. The resume will be updated to match.

## 9. Kickoff prompt

> Read SPEC.md and CLAUDE.md. This is an existing repo. Do milestone M0 only: explore the codebase and write `docs/AUDIT.md` covering everything in SPEC §2, including whether the app calls PubChem or PubMed and whether any API keys are exposed in the frontend. If the app runs, measure the current average search latency for 10 common drug names and record the method. Don't change any application code yet. Stop and summarize.
