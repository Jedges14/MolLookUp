# Working rules
- Read SPEC.md first. Implement only the milestone I ask for; stop and summarize when it's done.
- Never invent results. Every metric in README.md or RESULTS.md must come from a command you actually ran in this repo, and RESULTS.md records that command, the date and the git commit.
- If a number looks too good (e.g. >99% accuracy), assume a bug or data leak and investigate before reporting it.
- Never commit secrets, API keys, .env files, personal financial data or data that the license forbids redistributing. Use .env.example with placeholder values.
- Write tests alongside code, not at the end. A milestone is not done until its tests pass locally and in CI.
- Use small, focused commits with clear messages (Conventional Commits style: feat:, fix:, test:, docs:, chore:).
- Prefer simple, well-known libraries over clever ones. Pin dependency versions.
- Check current docs for library/model/API names and versions rather than relying on memory; model names and free-tier hosting terms change.
- Ask me before: adding a paid service, changing the stack in SPEC.md, deleting data, or force-pushing.

# Project rules
- Don't rewrite the app from scratch; refactor incrementally and keep it working after each milestone.
- Never call the real PubChem API in automated tests, CI or load tests.
- Keep the outbound rate below PubChem's published limit, even in benchmarks.
- Preserve existing data during migrations.
- If the measured latency reduction differs from 85%, report the real number. The resume will be updated to match.

# Repo notes
- Repo root is this folder (moved up from `frontend/` in M1; history preserved). `frontend/` = Vite React app, `backend/` = Node/TS/Express API, `bench/`, `docs/`.
- Backend: `npm test`, `npm run typecheck`, `npm run lint`, `npm run migrate`, `npm run seed`. Migrations are SQL files in `backend/migrations/` (node-pg-migrate). Never edit an applied migration; add a new one.
- All PubChem traffic goes through `backend/src/pubchem/client.ts` and the single process-wide `TokenBucket`. Unit tests inject a fake fetch; fixtures in `backend/test/fixtures/` are recorded real responses.
- Caching: `src/cache.ts` (RedisCache fails open: errors = miss), cache-aside in `src/compoundService.ts`. Keys are versioned (`search:v1:`, `compound:v1:`, `image:v1:`); bump the version if a cached shape changes. `npm run test:int` needs Docker.
- Tests: `backend` `npm test` (unit only), `npm run test:int` (Docker), `npm run test:coverage` (both); `frontend` `npm test`; `e2e` `npx playwright test` (needs compose postgres + redis; uses DB `mollookup_e2e` and Redis DB 1, never the dev data). E2E points the API at `e2e/mock-pubchem.mjs`.
- Secrets: see `docs/SECRETS.md`. Only `.env.example` files are committed.
- TypeScript is pinned to 6.0.x because typescript-eslint 8.x doesn't support TS 7 yet.
