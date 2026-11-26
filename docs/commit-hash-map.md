# Commit hash map

On 2026-11-26 this repository's history was rewritten to remove "Co-Authored-By: Claude" trailers from commit messages. File contents, authors and dates are unchanged, but every rewritten commit got a new hash. Markdown docs were updated to the new hashes; the `commit` fields inside `reports/metrics/*.json` (and `bench/results/*.json`) still hold the hash recorded at run time. Use this table to resolve them.

| old | new | subject |
|---|---|---|
| `1c45cfc` | `d5543b4` | refactor(frontend): move app to frontend/, migrate CRA to Vite, call backend only |
| `248ae2a` | `d0d3c77` | docs: M4 results (latency, load test, tests), README summary and screenshot |
| `252b77a` | `12f4899` | Merge pull request #1 from Jedges14/feat/m1-backend |
| `25903f7` | `8157df1` | feat(backend): CACHE_BYPASS mode for the uncached benchmark baseline |
| `2647acb` | `091ad67` | docs: live URL and deployment smoke-test results |
| `36cf7ef` | `1a7ab98` | feat(backend): Express API with rate-limited PubChem client, Postgres and Redis cache |
| `36fecc9` | `50d76d5` | build: docker-compose stack (api, postgres, redis, web) |
| `3a3acf6` | `d644cbf` | docs(results): record test and coverage numbers from commit 3d9c142 |
| `3d9c142` | `a4863c6` | docs: README, results and secrets guide |
| `5ef4510` | `65a8f88` | perf(bench): 200-query latency benchmark and k6 load test, with results |
| `630d5da` | `ce86897` | perf(frontend): replace 14.6 MB background PNG with 237 kB JPEG |
| `673a85b` | `37821a6` | test(e2e): Playwright search test against a mock PubChem server |
| `697b624` | `8f03f32` | build(deploy): Render blueprint, Vercel config, deploy guide, remote E2E smoke test |
| `7da3a88` | `8a32a5f` | Merge pull request #2 from Jedges14/feat/m4-benchmarks |
| `8f949f0` | `0b4fb09` | ci: GitHub Actions for lint, typecheck, tests, coverage, E2E and image build |
| `ab77a4f` | `5a22a28` | fix(config): reject connection URLs pasted with their key name or quotes |
| `d240c94` | `51a7f1f` | docs: add upgrade spec, M0 audit and baseline latency benchmark |
