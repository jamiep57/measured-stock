# Production runbook — Measured Stock

Operational checklist for the live deployment (Vercel + Supabase).

## Health signals

- **Staff PWA** (`/app`): offline banner + pending sync badge + “Synced … ago”
- **Admin** (`/`): sticky offline banner + topbar sync badge / last synced
- **Cron**: `/api/sync-catchup` daily 03:00 UTC (see `vercel.json`)
- **Client errors**: browser `error` / `unhandledrejection` are buffered in `sessionStorage` and beaconed to `/api/client-error` when available

## Sync / offline

1. Staff edits enqueue into IndexedDB (`measured-stock-v5` / `write_queue`).
2. Online flush runs on reconnect, on a 30s timer, and after pull-to-refresh.
3. Failed writes (5+ retries) show as “N syncs failed” on the badge.
4. Forensic audit panel can inspect queue stats for an event.

## Backup / restore

- Prefer Supabase dashboard PITR / scheduled backups for the project.
- Repo scripts under `scripts/` (e.g. backup helpers) are for migration/ops use — run from a trusted machine with service-role credentials, never from the browser.
- After restore: verify `events`, `event_products`, recent `stock_counts` / `deliveries`, and auth profiles.

## Auth / invites

- Session cookie is HttpOnly; logout clears it via `/api/logout`.
- Invite flow: `/onboard` with app-owned tokens (see invite docs in repo).
- If staff land mid-form after session expiry, they should be redirected to `/login` — ask them to re-auth and retry; queued offline writes still flush after login when online.

## Deploy checklist

1. `cd v5 && npm test` (unit) and targeted e2e if UI/auth changed
2. Confirm `vercel.json` rewrites for `/` (admin), `/app` (staff), `/scan`
3. Confirm custom `404.html` is served for unknown routes
4. Smoke: login → admin home → open event dashboard → mobile counts offline/online
5. Watch Vercel function logs + Supabase API logs for spikes after deploy

## Incident quick steps

| Symptom | Check |
|---|---|
| Nobody can log in | Auth env vars, Supabase Auth status, cookie domain/HTTPS |
| Mobile shows pending sync forever | Network, `/api` CORS, IndexedDB queue, `flushQueue` errors in console |
| Admin blank panel | Browser console, lazy chunk 404 after deploy, hard refresh |
| Square / sales stale | Till import panel, sync-catchup cron, Supabase logs |

## Contacts / ownership

Keep service-role keys and Postmark tokens in Vercel env only. Rotate if leaked. Document who owns Supabase project access separately from this repo.
