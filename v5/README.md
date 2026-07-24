# Measured Stock V5

V5 is two apps sharing one data layer and one design system:

| App | URL | Users | Purpose |
|---|---|---|---|
| **Mobile** | `/v5`, `/v5/counts`, … | Staff PIN | Counts + deliveries on site |
| **Admin** | `/v5/admin`, … | Admin PIN | Event setup, distribution, recon, Square |

V4 (`v2.html` at `/`) remains until admin panels reach parity, then admins cut over.

**Admin UI style guide:** [STYLEGUIDE.md](./STYLEGUIDE.md) — tokens, topbar, filter panel, data grid, and how to build new panels (Distribution is the reference implementation).

---

## Design principles

These rules apply to **both** mobile and admin unless noted.

### 1. WYSIWYG stock entry

What staff type is what is stored. No save/load conversion.

| Stock type | Column 1 | Column 2 |
|---|---|---|
| Spirits / wine (bottle) | Bottles | Partial (decimal, e.g. `0.5`) |
| Packaged beer / softs | Cases | Singles (loose cans only) |
| Kegs | Kegs | Partial |

Implementation: `src/pack-metrics.js`, `src/stock-entry.js`.

### 2. Fractions stay fractions (admin / recipes)

Recipe and COGS quantities are often entered as **fractions** (`1/24`, `1/28`, `3/24+1/48`).

**Problem in v2:** `evalMathInput()` converts `1/24` → `0.0417` on blur, which is hard to audit.

**V5 rule:** Store and display the **author's literal input** where possible (`qty_text` or display field). Use computed numeric value only for totals. Never silently rewrite a fraction to a decimal in the UI.

### 3. One product picker everywhere

Any “select a product” control uses the same **`ProductSearch`** component (`src/components/product-search.js`):

- Searchable dropdown (name, SKU, category, supplier)
- Shows pack size + **preferred supplier** + price hint
- When multiple suppliers exist, show badge count and let user pick offer
- Same component in: deliveries, counts (admin view), distribution, transfers, recipes, recon drill-down

### 4. Add product in context

**Problem in v2:** Log delivery → product missing → Library → create product → Products on event → add → back to delivery (4 steps).

**V5 rule:** From any line-item form, **“Add product”** opens a drawer that:

1. Creates product in library (or picks existing)
2. Adds to current event (`event_products`)
3. Optionally assigns to current bar (`bar_products`) if bar context is known
4. Returns to the original form with the new product selected

One flow, no panel hopping.

### 5. Multi-supplier clarity end-to-end

**Problem in v2:** A product can have several `product_suppliers` rows (different pack sizes/prices). Supplier choice is unclear in deliveries, opening, distribution, and recon.

**V5 rule:** Every money or quantity line that depends on supplier must show:

| Field | Source |
|---|---|
| **Supplier** | Selected offer (`product_suppliers`) or event default |
| **Pack / case size** | `purchase_case_size_id` → `case_sizes.label` |
| **Unit price / case price** | From that offer row |
| **Stock pack** | `stock_case_size_id` (how you count) vs **purchase pack** (how you buy) — show both when they differ |

Recon must tie invoice/delivery lines to **the supplier offer used**, not a ambiguous product-level price.

Preferred offer: `is_preferred` on `product_suppliers`; UI defaults to preferred but allows override per delivery/invoice with audit trail.

### 6. Per-bar product menus

- `event_products` = catalogue on the event
- `bar_products` = what each bar sells (Distribution)
- Mobile counts filter by `bar_products` (`src/bar-products.js`)

Admin Distribution uses a **bar-first menu builder**, not only a product×bar grid.

### 7. Reusable UI primitives

| Component | Use |
|---|---|
| `ProductSearch` | Any product pick |
| `SupplierOfferPick` | When multiple offers on a product |
| `Sheet` / `Drawer` | Mobile sheets; admin side panels |
| `QtyInput` | Two-column entry from `pack-metrics` + `cases-singles-input` |
| `FractionInput` | Recipe qty — WYSIWYG fraction text |
| `EventPicker` | Global event context (admin header) |
| `DataTable` | Sortable, searchable tables (admin) |
| `Toast` | Feedback (shared util) |

Build admin from these; do not one-off `<select>` lists per panel.

---

## Architecture

```
v5/
  index.html          → mobile entry
  admin.html          → admin entry
  src/
    mobile/           → (planned) staff app modules — currently at src/*.js
    admin/            → admin shell, router, panels
    shared/           → (planned) db, pack-metrics, stock-entry — currently at src/*.js
    components/       → cross-app UI (ProductSearch, Sheet, …)
    lib/              → util, sync-chrome
  public/             → sw.js, manifest (mobile)
```

Data layer: `assets/js/db.js` (Supabase). V5 wrapper: `src/db.js`.

---

## Admin routes

Real URLs (History API), not hash-only:

```
/v5/admin                              Event library / landing
/v5/admin/library                      Global product catalogue
/v5/admin/suppliers                    Supplier list
/v5/admin/case-sizes                   Pack definitions
/v5/admin/bugs                         Bug & feature reports

/v5/admin/events/:eventId              Event dashboard (see below)
/v5/admin/events/:eventId/setup        Bars, dates, suppliers, recipients
/v5/admin/events/:eventId/products     Event catalogue
/v5/admin/events/:eventId/opening      Opening stock
/v5/admin/events/:eventId/distribution Bar menus + allocations
/v5/admin/events/:eventId/deliveries
/v5/admin/events/:eventId/counts       Read-only sessions (staff enter on mobile)
/v5/admin/events/:eventId/stock-levels Live stock view
/v5/admin/events/:eventId/transfers
/v5/admin/events/:eventId/wastage
/v5/admin/events/:eventId/closing
/v5/admin/events/:eventId/recon        Financial recon
/v5/admin/events/:eventId/sales        Square + Modifiers (single page)
/v5/admin/events/:eventId/summary
```

### Event dashboard (new)

Consolidates v2 **Square stats + low-stock / running-out table** into one landing page per event:

- Import status (Square CSV, Modifier CSV)
- Mapping progress (% till lines mapped)
- **At-risk SKUs** (running low vs consumption) — moved from Square panel
- Quick links: Distribution, Recon, Sales mapping

### Sales page (Square + Modifiers unified)

v2 splits Square and Modifiers across two sidebar items. V5 admin combines:

- One import area (Square item sales + Modifier sales)
- One mapping workspace: tabs or split view for **Items** vs **Modifiers**
- Shared recipe library on the right
- Stock-warning rows highlighted (same logic as v2 `row-stock-warn`)
- Auto-map with review queue, not silent create

---

## Multi-supplier data model

```
products
  stock_case_size_id     → how stock is counted (bottle, case, keg)
  product_suppliers[]    → offers per supplier
    supplier_id
    purchase_case_size_id
    case_price / unit_price
    is_preferred
    sku

event_products           → product on event (+ opening/delivery aggregates)
delivery_lines           → should record which offer/supplier was used (enhancement)
```

**Recon display rule:** Each product row shows **active supplier for recon** (preferred unless delivery/invoice specifies otherwise). When offers disagree on pack size, show ⚠ and link to product offers editor.

---

## Build phases

### Phase 0 — Done (mobile)

- WYSIWYG counts/deliveries, offline queue, bar menu filter, count UX (save bar, focus mode)

### Phase 1 — Admin shell (in progress)

- [x] `admin.html`, router, sidebar, event context
- [ ] Extract `src/shared/` from mobile modules
- [ ] Middleware: staff blocked from `/v5/admin`
- [ ] Vercel SPA fallback for admin routes
- [ ] `ProductSearch` component (real implementation)

### Phase 2 — Distribution + products

- Bar-first menu builder
- Add-to-event-in-context drawer
- Multi-supplier offer display on product rows

### Phase 3 — Event ops

- Setup, opening, deliveries (admin), stock levels

### Phase 4 — Sales & recon

- Unified Sales page (Square + modifiers)
- FractionInput for recipes (no decimal conversion on blur)
- Recon with explicit supplier/offer column

### Phase 5 — Cutover

- Redirect `/` → `/v5/admin` for admins
- Retire `v2.html` panel-by-panel

---

## Migrations

| Migration | When |
|---|---|
| `043_v5_case_size_fks.sql` | Before V5 trial (done) |
| `044_v5_spirits_wine_bottle_stock.sql` | After mobile trial validates counts |

Future admin may need:

- `delivery_lines.supplier_id` / `product_supplier_id` for recon traceability
- `recipe_ingredients.qty_text` for fraction WYSIWYG

---

## Development

```bash
cd v5
npm install
npm run dev
```

| URL | App |
|---|---|
| http://localhost:5173/v5/ | Mobile |
| http://localhost:5173/v5/admin.html | Admin (dev); routes like `/v5/admin/events/…` |

```bash
npm test          # unit tests (pack-metrics, stock-entry, bar-products)
npm run build     # dist/ → mobile + admin bundles
```

Requires repo-root `/assets/js/db.js` (served in dev by Vite plugin).

---

## v2 parity checklist

| v2 panel | V5 admin route | Notes |
|---|---|---|
| Product Library | `/admin/library` | |
| Event Setup | `…/setup` | |
| Products | `…/products` | + in-context add |
| Opening | `…/opening` | |
| Distribution | `…/distribution` | Redesigned UX |
| Deliveries | `…/deliveries` | |
| Stock Counts | `…/counts` | Read-only; staff use mobile |
| Transfers | `…/transfers` | |
| Wastage | `…/wastage` | |
| Closing | `…/closing` | |
| Financial Recon | `…/recon` | Supplier-aware |
| Square | `…/sales` | Merged with modifiers |
| Modifiers | `…/sales` | Same page |
| Summary | `…/summary` | |
| Stock Levels | `…/stock-levels` | + dashboard widgets |
| Suppliers / Case sizes | global routes | |
| Bug & feature reports | `/admin/bugs` | |

---

## Related docs

- [`docs/V5_TRIAL.md`](../docs/V5_TRIAL.md) — mobile rollout checklist
- [`docs/PANELS.md`](../docs/PANELS.md) — v2 panel reference (legacy)
