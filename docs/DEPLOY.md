# Deploying MolLookUp (free tiers)

| Piece | Host | Free-tier notes (checked 2026-11-26; re-check the pricing pages before relying on them) |
|---|---|---|
| Frontend (static Vite build) | **Vercel** (Hobby) | Free for personal, non-commercial projects. |
| API (Docker) | **Render** web service | Sleeps after ~15 min idle; the first request after that takes about a minute. 750 instance-hours/month. |
| Postgres | **Neon** Free | No card; storage per project is 0.5–1 GB depending on source; compute scales to zero after 5 min idle. |
| Redis | **Upstash** Free | ~500K commands/month and ~256 MB. Each search uses 1–2 commands. Adding a card moves resources to paid. |

Render's own free Postgres is deleted 30 days after creation, so Neon is used instead.
All four need accounts in your name; none needs a credit card at the time of writing.

## Steps

1. **Neon:** create a project (Postgres 17 if offered), copy the connection string (it ends in `?sslmode=require`).
2. **Upstash:** create a Redis database (TLS on), copy the `rediss://…` URL.
3. **Render:** New → **Blueprint** → connect GitHub → pick `Jedges14/MolLookUp`. It reads `render.yaml`.
   Fill in the secret env vars: `DATABASE_URL` (Neon), `REDIS_URL` (Upstash), `RAPIDAPI_KEY` (your rotated key),
   and leave `CORS_ORIGIN` as a placeholder for now. Deploy. Migrations run automatically at container start.
   Check `https://<render-name>.onrender.com/health` returns `{"status":"ok","db":"ok","redis":"ok",…}`.
4. **Vercel:** Add New → Project → import `Jedges14/MolLookUp`. Root Directory: `frontend`. Framework: Vite.
   Environment variable `VITE_API_URL` = your Render URL (no trailing slash). Deploy.
5. Back in Render, set `CORS_ORIGIN` to the Vercel URL (e.g. `https://mollookup.vercel.app`) and redeploy.
6. Optional: seed the "molecule of the day" compounds into Neon from your machine:
   `cd backend; $env:DATABASE_URL='<neon url>'; npm run seed` (one batched PubChem request).

Both Render (`autoDeploy`) and Vercel redeploy on every push to `main`, after CI runs on the PR.

## After deploying

- Run the E2E smoke test against production (read-only; it searches aspirin and one misspelling; the first
  request may take a minute while Render wakes the API):
  `cd e2e; $env:E2E_BASE_URL='https://<your-app>.vercel.app'; npx playwright test`
- Put the public URL at the top of the README and in the resume.
- Keep `CACHE_ONLY` and `CACHE_BYPASS` unset in production (the API refuses `CACHE_BYPASS` there).
