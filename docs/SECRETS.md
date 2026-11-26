# Secrets: the RapidAPI key (daily fact)

The daily science fact comes from "Facts by API Ninjas" on RapidAPI. The key lives **only on the backend**, read from
the `RAPIDAPI_KEY` environment variable. It is never sent to the browser and never committed.

## 1. Rotate the leaked key (one time, required)

The old key was committed in `a382720` (2025-06-24) and is in the public repo's history. Removing it from the code
doesn't revoke it, so replace it in RapidAPI. Steps are from RapidAPI's guide
(https://docs.rapidapi.com/docs/keys-and-key-rotation):

1. Sign in and open the **Developer Dashboard**: https://rapidapi.com/developer/dashboard
2. Under **Apps**, select the app the key belongs to (often named `default-application_…`).
3. Open its **Authorization** page.
4. Click **Add authorization**, give it a name (e.g. `mollookup-2026`). A new key appears; copy it.
5. Optional check: on the "Facts by API Ninjas" listing, open **Endpoints**, pick the new key in the **X-RapidAPI-Key**
   dropdown, and click **Test Endpoint**.
6. Put the new key in `.env` (step 2 below) and confirm `/api/fact` works.
7. Back on the app's **Authorization** page, **delete the old (compromised) key**. This is the step that actually stops
   the leaked key from working.

## 2. Give the new key to the backend

**Docker Compose (normal way).** In the repo root (`mollookup/`):

```powershell
Copy-Item .env.example .env    # only if .env doesn't exist yet
notepad .env                   # set RAPIDAPI_KEY=<your new key>, save
docker compose up -d api       # recreates the API container with the new env
```

**Running the API without Docker.** Put the same line in `backend/.env` instead, then restart `npm run dev`.

## 3. Check it

```powershell
curl.exe -s http://localhost:3001/api/fact
```

Expected: `{"fact":"..."}`. A `503 FACT_UNAVAILABLE` means the key is missing (check the variable name and that you
restarted the API); a `503` with "unavailable right now" means RapidAPI rejected it (wrong key or no subscription).
The API logs the upstream status: `docker compose logs api | Select-String fact`.

## Rules

- `.env` files are git-ignored (`git check-ignore -v .env` prints the rule). Only `.env.example` files, with empty
  values, are committed.
- Never paste the key into code, issues, PRs, chat, or a URL query string.
- For deployment (M4), set `RAPIDAPI_KEY` as a secret in the hosting provider's dashboard, not in the repo.
