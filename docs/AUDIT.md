# MolLookUp audit (M0)

Date: 2026-11-25 · Repo: github.com/Jedges14/MolLookUp · Audited commit: `74edcf2` (+ 2 uncommitted CSS edits) · No application code was changed.

## TL;DR

1. **The search calls Wikipedia, not PubChem or PubMed.** `submitAPI.js` exports a function named `PubChem`, but it fetches `en.wikipedia.org/api/rest_v1/page/summary/<name>` and shows the `extract` text. PubChem is used in one place only: the "Molecule of the day" `<img>` loads `pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/<cid>/PNG` for 25 hard-coded molecules. PubMed and RDKit (both named in the README) aren't used anywhere.
2. **There's no backend, no SQL and no search cache, and there never has been.** `backend/` is an empty `scripts.py` plus a Python venv. Git history (6 commits, June 15–27, 2025) has no database, SQL or cache code. The only caching is `localStorage` for the molecule of the day (3 min) and the daily fact (1 day); search results aren't cached.
3. **The "85% latency reduction" can't be recovered or reproduced.** Nothing in the code or history measures latency or caches search results. It has to be re-measured after M2 (SPEC §5).
4. **A RapidAPI key is hard-coded in the frontend** (`src/landingAPI.js`), added in `a382720` (2025-06-24) and pushed to `origin/main`. An anonymous `git ls-remote` worked, so the repo looks public. **Rotate the key now**; removing it from the code won't remove it from history.

## Current structure

| Item | Today |
|---|---|
| Frontend | Create React App (`react-scripts` 5.0.1), React 19.1, plain JavaScript, one component (`Landing.js`) |
| Backend | None (`backend/scripts.py` is empty, 0 bytes; the venv isn't source code) |
| "SQL" | None. No database, schema, ORM or SQL file anywhere in history |
| External calls (all from the browser) | Wikipedia REST summary (search) · RapidAPI "Facts by API Ninjas" (daily fact, with key) · PubChem PUG-REST PNG by CID (molecule-of-the-day image) |
| Data | `src/molecules.js`: 25 hand-written molecules (name, formula, weight, CID, summary, fun fact) |
| Tests | 1 CRA boilerplate test, which fails (see Bugs) |
| CI / Docker / deploy | None |
| Runs? | Yes. `npm ci` and `react-scripts build` succeed (62.8 kB gzipped JS, one lint warning). The build folder is 16 MB, almost all of it the background PNG |
| Git layout | The repo root is the React app. `backend/` sits outside the repo (in the Desktop copy it's in a separate, empty `.git`) |

How it runs today: `cd frontend && npm ci && npm start`, which serves on :3000. Search → `fetch` to Wikipedia from the browser → shows the summary paragraph or an error string.

## Bugs

| # | Where | Issue |
|---|---|---|
| B1 | `src/molecules.js` | 3 of 25 CIDs are wrong, so the wrong structure image shows. Checked with one batched PubChem property request: **LSD** `8223` is ergotamine (LSD is CID 5761). **Insulin** `6926` is 2-aminobenzenesulfonic acid. **Hemoglobin** `443` is an androstanedione. Insulin and hemoglobin are proteins with no small-molecule CID, so drop them or swap them out. |
| B2 | `src/landingAPI.js:15` | `return 'No science fact, today..', error;` uses the comma operator and returns the **error object**, not the string. The build also flags it (`no-sequences`). |
| B3 | `src/App.test.js` | Imports `./App`, which was deleted, so the only test suite fails ("Cannot find module"). |
| B4 | `src/submitAPI.js` | The URL template starts with a space (`` ` https://…` ``). It works because the URL parser trims it, but it's fragile. Error mapping checks 400/500, while Wikipedia returns 404 for unknown pages, so every miss falls through to the generic message. That's fine, but the 400/500 branches are dead. |
| B5 | `Landing.js` | Search results show only Wikipedia's prose `extract`: no formula, weight or structure. Any Wikipedia page is "found" (e.g. "Paris"), so it isn't a molecule lookup. |
| B6 | `Landing.js` | Invalid JSX/HTML: `<label for>` should be `htmlFor`, `<h3>` inside `<p>`, a meaningless `formTarget='description-field area'`, and the inline `style={{justifyContent}}` on an `<h3>` does nothing. Nav items, "UserLogin" and the footer are static text with no behavior. |
| B7 | `src/components/background1.png` | A 14.6 MB background image dominates page weight and load time. |
| B8 | `README.md` | It says the app uses PubMed and RDKit. Neither is true. |

## Security

- **S1 (high): an exposed RapidAPI key** in client code and public git history. Rotate it in the RapidAPI dashboard. Move the fact call behind the backend (M1) with the key in `.env`.
- **S2: no SQL-injection surface today** (no SQL). User input reaches Wikipedia through `encodeURIComponent`, and output is rendered as React text (no `dangerouslySetInnerHTML`), so no XSS found.
- **S3:** `.gitignore` covers `.env.*.local` but not plain `.env`. Add `.env` before M1 introduces one.
- **S4:** No PubChem politeness controls exist. Today the browser fetches one PNG per page view, which is harmless, but M1 must route everything through the rate-limited client.

## Dead code

`src/reportWebVitals.js` (called with no handler), the leftover CRA `App.test.js`, the 400/500 branches in `submitAPI.js`, and `backend/` (empty). `public/index.html` links `logo192.png`, which was deleted in history, so it returns 404.

## Baseline latency (current app's search call)

**Method.** [`bench/baseline_m0.mjs`](../bench/baseline_m0.mjs) replays exactly what `submitAPI.js` does: a GET to the Wikipedia REST summary endpoint, then `.json()`. It runs for 10 common drugs (aspirin, ibuprofen, acetaminophen, caffeine, metformin, atorvastatin, amoxicillin, omeprazole, lisinopril, penicillin), 3 rounds, sequentially, 1 s apart. Timing comes from Node's `performance.now()`, so it covers network and JSON parsing only, not browser rendering. Command: `node bench/baseline_m0.mjs 3`. Raw output: [`bench/baseline_m0_output.txt`](../bench/baseline_m0_output.txt).

**Environment.** 2026-11-26 03:29 UTC (2026-11-25 evening, US Eastern) · Windows 11 laptop, home network · Node v22.16.0.

| Set | n | mean | p50 | p95 | min | max |
|---|---|---|---|---|---|---|
| All requests | 30 | 52.5 ms | 17.6 ms | 259.9 ms | 10.4 ms | 780.2 ms |
| Round 1 (first request per name) | 10 | 127.0 ms | 31.4 ms | 780.2 ms | 21.1 ms | 780.2 ms |
| Rounds 2–3 (repeats) | 20 | 15.2 ms | 13.2 ms | 19.7 ms | 10.4 ms | 23.4 ms |

Failures: 2/30. Both were `atorvastatin` in rounds 2–3, where the fetch threw a network error. The same URL returned 200 when retried a few minutes later, so they look transient.

**How to read this.**
- Wikipedia sits behind a global CDN, so these numbers are fast. The drop from round 1 to the repeats (about 88%) comes from **Wikipedia's edge cache, not MolLookUp**. It must **not** be used as evidence for the resume's caching claim.
- This baseline describes today's Wikipedia-backed search. It isn't a valid "uncached" baseline for the upgraded app, which will call PubChem: PubChem is slower and rate-limited to ≤4 requests/s. The resume's % reduction must come from SPEC §5 benchmark 1 (PubChem uncached vs. Redis/Postgres warm, 200 names), run after M2.

## Proposed change list (mapped to SPEC milestones)

**Before M1 (Jedges, no code):**
- Rotate the RapidAPI key (S1).
- Approve the repo restructure: move the git root up from `frontend/` to `mollookup/`, so `frontend/`, `backend/`, `bench/` and `docs/` share one repo. History is kept with `git mv`.

**M1: Backend + PubChem client**
- New `backend/`: Node.js + TypeScript + Express (SPEC §3 default, since no backend exists). Delete the empty Python venv/`scripts.py` from the project (not tracked in git).
- Postgres with node-pg-migrate: create the `compounds` and `compound_synonyms` schema. There's no existing data to migrate. Seed it from `molecules.js` after fixing B1.
- PubChem client: token bucket ≤4 req/s, retries with backoff and jitter on 503, a 30 s timeout, a descriptive User-Agent, batched CID property requests.
- Endpoints: `/api/compounds/search`, `/api/compounds/:cid`, `/api/compounds/:cid/image`, `/health`. Zod validation and consistent JSON errors.
- Move the daily fact behind `/api/fact` with the key from `.env` (S1). Add `.env` to `.gitignore` (S3) and create `.env.example`.
- Frontend calls only the backend. Search shows the formula, MW and the structure image from `/api/compounds/:cid/image` (fixes B5). Rename `submitAPI.js` → `api.js`. Fix B2, B4 and B6.
- **Migrate CRA → Vite now.** CRA is deprecated, the app is one component, so it's cheap. TypeScript conversion is optional: do it in the same step, since the app is small.
- docker-compose: api, postgres, redis, frontend.

**M2: Caching**
- Redis cache-aside (`search:<q>`, `compound:<cid>`), negative caching (10 min), `Cache-Control` on images, `/metrics` (hit ratio, p50/p95).
- Cache-only mode flag for k6.

**M3: Tests + CI**
- Replace the broken `App.test.js` (B3) with Vitest + RTL tests (search box, loading/empty/error states).
- Unit tests: normalization, cache keys, limiter (fake timers), parsing with recorded PubChem fixtures. Integration tests with real Redis/Postgres and PubChem mocked by nock/MSW. One Playwright test (aspirin → image + formula).
- GitHub Actions: lint → typecheck → test → build images. Coverage goes in RESULTS.md.

**M4: Deploy + benchmarks**
- Compress or replace the 14.6 MB background (B7).
- `bench/`: 200 names (180 drugs + 20 misspellings), uncached vs. warm, and k6 at 10/50/100/200 VUs in cache-only mode.
- Rewrite the README (B8, architecture diagram, screenshot). Deploy. RESULTS.md gets the real % reduction, which goes on the resume.

## Resume impact

| Claim | Status today | Action |
|---|---|---|
| "retrieves drug structures from the PubChem API and renders them" | Partly true: PubChem structure PNGs for 25 hard-coded molecules; search uses Wikipedia | True after M1 |
| "React, JavaScript, SQL" | No SQL | Keep "SQL" off until M1 lands |
| "Cut average search latency by 85% … caching" | Not supported: no search cache exists | Replace with the M2/M4 measured number |
| "[backend]" | None | Node.js/TypeScript/Express after M1 |

👤 **Jedges:** review this file, rotate the key, and approve (or edit) the change list before any code changes.
