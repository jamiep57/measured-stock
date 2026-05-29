# Architecture

## Overview

The app is a single-page application with no framework. All state lives in a JavaScript object called `state`. The UI is a set of `<div class="panel">` elements — only one is visible at a time. Navigation switches which panel has the `active` class.

---

## Files

### `index.html`
Pure markup. No inline styles, no inline scripts. Contains:
- The sidebar (navigation, event switcher, logo)
- The topbar (panel title, event name pill)
- One `<div id="panel-*">` per screen
- Three modals (product, count session, import preview)
- Two `<script>` tags at the bottom: SheetJS CDN, then `assets/js/app.js`

### `assets/css/style.css`
All styles. Key sections (in order):
1. **CSS custom properties** — design tokens (colours, radius, sidebar width)
2. **Reset & body** — base font, background
3. **Layout** — `.app-shell`, `.sidebar`, `.main-content`
4. **Sidebar** — header, nav items, event switcher
5. **Topbar** — sticky header bar
6. **Cards** — `.card`, `.stat-card`
7. **Forms** — `label`, `input`, `select`
8. **Buttons** — `.btn`, variants (primary, secondary, outline, danger, ghost)
9. **Tables** — `.table-wrap`, `thead`, `tbody`
10. **Badges** — category colour pills
11. **Misc** — toasts, modals, progress bars, chips, empty states

### `assets/js/app.js`
All application logic. Key sections (marked with `// ===` comments):
1. **DATA STORE** — `state` object, `blankEvent()`, `appData` multi-event container
2. **CLOUD CONFIG** — Supabase credentials, `cloudUpsertEvent()`, `cloudLoadAllEvents()`, polling
3. **LOAD / SAVE** — `load()`, `save()`, `renderAll()`
4. **SETUP** — bar/supplier/category/recipient CRUD, `updateShowName()`, `updateShowDates()`
5. **PRODUCTS** — `renderProducts()`, `openAddProduct()`, `saveProduct()`, `deleteProduct()`
6. **OPENING STOCK** — `renderOpening()`, `saveOpening()`
7. **DISTRIBUTION** — `renderDistribution()`, `saveDistribution()`
8. **STOCK COUNTS** — `renderCountSessions()`, `openNewCountSession()`, `saveCurrentCount()`
9. **TRANSFERS** — `renderTransfers()`, `logTransfer()`, `addTransferLine()`
10. **CLOSING STOCK** — `renderClosing()`, `saveClosing()`
11. **SUMMARY** — `renderSummary()`
12. **EXCEL IMPORT** — `importProductsFile()`, `confirmImport()`, `downloadImportTemplate()`
13. **CLOUD UI** — `connectCloud()`, `testCloud()`, `disconnectCloud()`
14. **INIT** — `load()`, auto-sample data on first launch, `initPillDelegation()`
15. **UI PATCHES** — `showPanel()` override for sidebar active state + topbar title

---

## Navigation

`showPanel(id)` is the single navigation function. It:
1. Hides all `.panel` elements
2. Shows `#panel-{id}`
3. Updates sidebar `.nav-item` active states
4. Updates the topbar title
5. Calls the relevant render function for that panel

To add a new panel:
1. Add `<div id="panel-newname" class="panel">` markup in `index.html`
2. Add a `<button class="nav-item" data-panel="newname">` in the sidebar
3. Add a `case 'newname': renderNewname(); break;` in `showPanel()` in `app.js`
4. Add the `renderNewname()` function to `app.js`

---

## State Management

Everything is stored in `state` (see `DATA_MODEL.md`). The flow is:

```
User action → update state → save() → re-render affected panel
```

`save()` writes `appData` (which contains all events) to `localStorage`. If Supabase is connected, it also calls `cloudUpsertEvent(state)`.

`load()` reads from `localStorage` on startup. If cloud is configured, it also pulls from Supabase.

---

## Styling Conventions

- **Design tokens** — always use CSS variables (`var(--border)`, `var(--primary)`, etc.), never hardcode colours
- **Border radius** — use `var(--radius)` (currently 4px). Do not use hardcoded `px` values
- **Font** — Outfit via Google Fonts. Already set on `body`, so inherited everywhere
- **Spacing** — no spacing scale variable; use `px` values consistent with existing patterns (8, 12, 14, 16, 20, 24px)
- **Buttons** — always use `.btn` base class + a variant class. Never style buttons inline
- **Tables** — always wrap in `.table-wrap` for overflow scroll on mobile

---

## Cloud Sync

Supabase is used as a simple key-value store. The table schema is:

```sql
create table stock_events (
  id text primary key,       -- event UUID
  name text,                 -- event display name
  data jsonb,                -- full serialised state object
  updated_at timestamptz default now()
);
```

The entire `state` object is stored as a single JSONB blob per event. There is no relational schema. Polling runs every 8 seconds when connected and updates non-active events from remote.
