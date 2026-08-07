# Measured Stock — Playwright E2E (Python)

Browser tests for V5 admin. Fixtures seed tagged `[E2E]` rows in Supabase, run the scenario, then delete those rows (plus an orphan sweep at session end).

## Libraries to install

From the `e2e/` folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

| Package | Purpose |
|---|---|
| `playwright` | Browser automation |
| `pytest` | Test runner |
| `pytest-playwright` | Playwright fixtures (`page`, browser) |
| `pytest-base-url` | Base URL config |
| `supabase` | Seed + cleanup against PostgREST |
| `python-dotenv` | Load `e2e/.env` |
| `httpx` | Transitive HTTP client (supabase) |

## Configure

```bash
cp .env.example .env
```

Set at least:

- `BASE_URL` — usually `https://localhost:5173` (Vite HTTPS)
- `E2E_EMAIL` + `E2E_PASSWORD` — **active admin** on the same Supabase project
  (required for seed/cleanup after migration `062_auth_rls.sql`, which revoked anon CRUD)
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` — database the app should use
- `SUPABASE_SERVICE_KEY` — optional; must be the **same project** as `SUPABASE_URL`
  (a key from another project is ignored)

The suite signs in via the Auth API and injects the session into the browser
(so fixtures skip Google OAuth). `test_01` also covers the email login form.

### Prefer a test database (recommended)

Do **not** point these tests at production if you can avoid it.

**Option A — Supabase branch (best match for this repo)**  
Create a branch (e.g. `e2e`) in the Supabase dashboard. Put the branch URL + anon key in `e2e/.env`. Schema is applied; production data is not copied. Fixtures seed only what each test needs.

**Option B — Separate Supabase project**  
Same idea: empty/dev project with migrations applied, credentials in `e2e/.env`.

**Option C — Tagged cleanup on a shared non-prod DB**  
Works today: every row is named `[E2E] …` and deleted after each test. Session teardown also sweeps leftover `[E2E]` events/products/suppliers. Still safer than production.

Local `supabase start` is possible once this repo has a linked `supabase/` config; until then, A or B is simpler.

## Start the app

In one terminal:

```bash
cd v5
npm run dev
```

Admin: `https://localhost:5173/v5/admin`

## Run tests (from Cursor)

1. Open the integrated terminal (**Terminal → New Terminal**).
2. Start Vite if it is not already running (`cd v5 && npm run dev`).
3. Run:

```bash
cd e2e
source .venv/bin/activate
pytest -v
```

Useful variants:

```bash
# One scenario
pytest -v tests/test_top10_scenarios.py::test_02_create_event_via_ui

# Use system Google Chrome (skips downloading Playwright Chromium ~170MB)
PLAYWRIGHT_CHANNEL=chrome pytest -v --browser-channel chrome

# Or the helper script
./run.sh -v

# Headed (watch the browser)
pytest -v --headed --slowmo 200

# Stop on first failure
pytest -v -x

# Open a failure trace
playwright show-trace test-results/.../trace.zip
```

You can also ask the Cursor agent: “run the e2e tests” — it should use the same `e2e/.venv` + `pytest` commands.

## Top 10 scenarios

| # | Test | What it covers |
|---|---|---|
| 1 | `test_01_admin_login_via_email_form` | `/login` email + password → admin home |
| 2 | `test_02_create_event_via_ui` | Create event drawer |
| 3 | `test_03_setup_add_bar` | Event setup → add bar |
| 4 | `test_04_library_create_product` | Product library create |
| 5 | `test_05_add_product_to_event` | Add library SKU to event |
| 6 | `test_06_distribution_shows_allocation` | Distribution grid |
| 7 | `test_07_deliveries_list_seeded_delivery` | Deliveries list |
| 8 | `test_08_transfers_list_seeded_transfer` | Transfers list |
| 9 | `test_09_closing_shows_product_row` | Closing stock |
| 10 | `test_10_recon_shows_product` | Financial recon |

## More scenarios (11–17)

| # | Test | What it covers |
|---|---|---|
| 11 | `test_11_dashboard_loads` | Event dashboard |
| 12 | `test_12_wastage_shows_seeded_batch` | Wastage list |
| 13 | `test_13_counts_shows_seeded_session` | Stock counts |
| 14 | `test_14_sales_panel_loads` | Sales panel |
| 15 | `test_15_suppliers_list_shows_seeded` | Suppliers search |
| 16 | `test_16_setup_edit_event_name` | Setup name autosave |
| 17 | `test_17_audit_panel_loads` | Dev audit panel |

## Cleanup guarantees

- Function fixtures `seed` / `seed_minimal` / `tracker` delete created IDs in `finally`
- Event delete cascades bars, event_products, deliveries, distribution, etc.
- Products use `delete_product` RPC (with a manual fallback)
- Session-end `sweep_orphaned_e2e` removes any leftover `[E2E]%` rows

## Layout

```
e2e/
  conftest.py              # fixtures, HTTPS ignore, session inject
  helpers/db.py            # seed + cleanup
  helpers/auth.py          # login + navigation
  helpers/pages.py         # toolbar helpers
  tests/test_top10_scenarios.py
  tests/test_more_scenarios.py
  tests/test_seed_cleanup.py
  .env.example
  requirements.txt
  pytest.ini
  run.sh
```
