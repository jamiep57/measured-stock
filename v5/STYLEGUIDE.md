# V5 Admin Style Guide

Reference for building admin panels consistently.

**Canonical references:**

| Pattern | Live page | Copy for |
|---|---|---|
| Floating shell + sidebar | `/v5/admin` (Events home) | Layout, nav, cards, page surfaces |
| List panel + drawer | `/v5/admin/events/:id/deliveries` | Topbar CTA, list cards, `sheet--admin-full` forms |
| Data grid | `/v5/admin/events/:id/distribution` | Sticky matrix, filter panel, product search integration |

**Live reference:** run `npm run dev` in `v5/` and open any of the pages above.

**Related docs:** product/data rules in [README.md](./README.md). Mobile styling shares base tokens in `src/styles/v5.css`.

---

## 1. Design language

Admin UI uses a **floating card shell** on a light canvas:

- Page background: `--background` (`#fafafa`)
- Surfaces: white cards with `1px` border, **12px** outer radius, soft shadow
- Inset from viewport edges by **12px** (`--sidebar-gap`)
- Interactive hovers: `var(--secondary)` fill — not inverted dark pills (except primary CTAs)
- Section labels: 11px uppercase, muted, with collapsible chevrons
- Primary actions: solid `--primary` (`#18181b`) buttons at `--topbar-h`

```
  ┌─ canvas (#fafafa) ─────────────────────────────────────────────┐
  │  ┌ sidebar card ─┐   ┌ main shell card ──────────────────────┐  │
  │  │ workspace      │   │ topbar │ tools                      │  │
  │  │ nav sections   │   ├──────────────────────────────────────┤  │
  │  │ footer         │   │ content (tinted) / panels / grid    │  │
  │  └────────────────┘   └──────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────┘
                                      ┌─ drawer card (slides in) ─┐
                                      │ head / body / foot          │
                                      └─────────────────────────────┘
```

---

## 2. Design tokens

Defined in `src/styles/v5.css` (shared) and overridden for admin in `src/styles/admin.css` via `body:has(.admin-app)`.

### Colour

| Token | Value | Use |
|---|---|---|
| `--background` | `#fafafa` | Page canvas |
| `--foreground` | `#09090b` | Primary text |
| `--card` | `#ffffff` | Shell surfaces, cards, inputs |
| `--primary` | `#18181b` | Primary buttons, emphasis |
| `--secondary` | `#f4f4f5` | Hover fills, nav active, table headers |
| `--muted-foreground` | `#71717a` | Labels, meta, placeholders |
| `--border` | `#e4e4e7` | All borders |
| `--success` | `#16a34a` | Positive states |
| `--danger` | `#dc2626` | Errors, over-allocated |
| `--warning` | `#b45309` | Warnings |

**Workspace mark gradient** (sidebar logo tile): `linear-gradient(135deg, #dc2626 0%, #7c3aed 100%)`.

Semantic tints (not tokens yet — reuse these values):

| Class | Background | Text | Use |
|---|---|---|---|
| `.lta-ok` | `#dcfce7` | `#166534` | Stock remaining |
| `.lta-neutral` | `var(--secondary)` | `var(--muted-foreground)` | Fully allocated |
| `.lta-over` | `#fee2e2` | `#991b1b` | Over-allocated |

### Radius & shadow (admin)

| Token | Value | Use |
|---|---|---|
| `--shell-radius` | `12px` | Sidebar, main shell, drawer, page cards |
| `--shell-shadow` | see `admin.css` | Floating cards, dropdowns, toasts |
| `--radius` | `0.5rem` (8px) | Controls, inputs, toolbar strips, nav items |
| `--radius-sm` | `4px` | Dense chips, small indicators |
| `--radius-lg` | `0.625rem` (10px) | Dropdowns, filter panel, line cards |

Pills (search field, status dots) use `border-radius: 999px`.

### Layout

| Token | Value | Use |
|---|---|---|
| `--sidebar-w` | `260px` | Sidebar width (220px below 900px) |
| `--sidebar-gap` | `12px` | Inset from viewport; gap between sidebar and main |
| `--topbar-h` | `36px` | Toolbar height, search input, primary CTA height |

### Typography

- **Font:** [Outfit](https://fonts.google.com/specimen/Outfit) (loaded in `admin.html`)
- **Body:** 15px / 1.5 (mobile base); admin UI mostly 12–14px inside controls

| Element | Size | Weight |
|---|---|---|
| Page title (`.topbar-title`) | 16px | 600 |
| Drawer title (`.sheet-title`) | 16px | 600 |
| Sidebar nav (`.nav-link`) | 14px | 500 (600 when active) |
| Workspace name / card title | 14–15px | 600 |
| Section toggles (`.sidebar-section-toggle`) | 11px | 700, uppercase |
| Filter group labels (`.tfp-group-label`) | 10px | 700, uppercase |
| Grid body (`.dist-grid`) | 13px | 400 (product name), 500 (numbers) |
| Bar column headers (`.dist-bar-name`) | 9px | 700, uppercase |

Use `font-variant-numeric: tabular-nums` on numeric columns.

---

## 3. Icons

**Library:** [Lucide](https://lucide.dev/) via `src/lib/icons.js`.

### Static HTML

```html
<i data-lucide="funnel" aria-hidden="true"></i>
```

Call `initIcons()` after inserting into the DOM (done globally on boot in `admin/main.js` and after sidebar sync).

### Templates / JS

```js
import { icon } from '../lib/icons.js';

icon('funnel', { size: 16, strokeWidth: 1.75 })
```

### Sizes

| Context | SVG size |
|---|---|
| Sidebar nav | 18px |
| Topbar tools | 16px |
| Filter panel tabs | 14px |
| In-cell actions (grid) | 14px / 11px |

### Adding an icon

1. Import from `lucide` in `src/lib/icons.js`
2. Add kebab-case key to `iconsByKebab`
3. Use `data-lucide="kebab-name"` or `icon('kebab-name')`

**Do not** add Phosphor or other icon CDNs to admin.

---

## 4. Admin shell

| File | Role |
|---|---|
| `admin.html` | Shell markup (sidebar + `.admin-shell`) |
| `src/admin/main.js` | Boot, router, panel mount |
| `src/admin/sidebar.js` | Workspace switcher, collapsible sections |
| `src/admin/router.js` | URL ↔ panel routing, nav active state |
| `src/styles/admin.css` | Admin layout, surfaces, drawer, grid |
| `src/styles/v5.css` | Shared tokens + mobile |

Event panels register in `src/admin/panels/index.js`.

### Sidebar (`.admin-sidebar` → `.sidebar-inner`)

Floating card, fixed left, full height minus gaps.

| Region | Markup / behaviour |
|---|---|
| **Workspace switcher** | `#sidebarWorkspace` — logo mark, name/subtitle, chevron menu to jump events |
| **Primary nav** | `#sidebarPrimary` — Events (home) link |
| **Catalog** | `#sidebarGlobal` — Library, Suppliers, Case sizes (collapsible) |
| **Event sections** | Setup / Stock / Sales & recon — shown when `route.view === 'event'` |
| **Footer** | Link to mobile bar app (`/v5`) |

**Nav link states:**

- Default: transparent background, muted icon
- Hover: `var(--secondary)` fill, 8px radius
- Active: `var(--secondary)` fill, `font-weight: 600` — **not** inverted dark pill

Section collapse state persists in `localStorage` (`v5-admin-sidebar-sections`).

### Main shell (`.admin-main` → `.admin-shell`)

Second floating card containing topbar + scrollable content.

| Region | Class | Notes |
|---|---|---|
| Topbar | `.admin-topbar` | Title left; tools right |
| Content | `.admin-content` | Tinted background; 16px padding |

Full-bleed grids: `.admin-content:has(.dist-panel)` drops overflow to panel.

### Page layout classes

Wrap panel markup consistently:

```html
<div class="admin-page">
  <div class="admin-surface panel-placeholder">…</div>
</div>
```

| Class | Use |
|---|---|
| `.admin-page` | Max-width container (`1200px`) for list/placeholder pages |
| `.admin-surface` | Bordered card surface inside content (placeholders, etc.) |
| `.admin-empty` | Dashed empty state (events list, delivery list) |
| `.admin-eyebrow` | “Coming soon” label above placeholder headings |
| `.event-grid` / `.event-card` | Events home grid |
| `.event-breadcrumb` | Event name above in-event placeholder panels |

---

## 5. Topbar toolbar

Compact **disconnected strips** aligned to the right. Each strip is a bordered `.topbar-toolbar` box; strips are separated by `10px` gap.

### Typical layout (right → left)

```
[ Log delivery ]  [ Upload · Download · Print ]  [ Filter ]  [ Search ⌐ ]
   primary CTA           icon strip                  strip      pill field
```

| Piece | Markup / module |
|---|---|
| Icon strips | `#topbarToolbarStrips` — rendered by `src/admin/topbar-toolbar.js` |
| Filter | `#topbarFilterStrip` — funnel button + `#topbarTableFilterPanel` dropdown |
| Search | `#topbarSearch` — `ProductSearch` via `src/admin/global-search.js` |

### Tool button (`.topbar-tool`)

- Icon-only: **28×28px** hit target inside **36px** strip (`--topbar-h`)
- Borderless; hover → `var(--secondary)` fill
- Active filter → `.topbar-tool--active` (tint + dot indicator)
- Disabled → `opacity: 0.35`

### Primary CTA (`.topbar-tool--primary`)

Used for panel actions like **Log delivery**:

- Solid `--primary` background, white text/icon
- **No nested white toolbar chrome** when it is the strip's only child (strip border/padding removed via `:has()`)
- Full `--topbar-h` height, 8px radius

```js
{ id: 'log-delivery', icon: 'plus', label: 'Log delivery', primary: true }
```

### Wiring a new panel

Add strips to `PANEL_TOOLBAR` in `src/admin/topbar-toolbar.js`:

```js
export const PANEL_TOOLBAR = {
  distribution: [ /* edit strip, data strip */ ],
  deliveries: [ /* actions strip with primary CTA, data strip */ ],
};
```

Filter/sort/columns use the shared **table filter panel** (below), not the strip config.

---

## 6. Table filter panel

Reusable tabbed filter dropdown for data tables.

| File | Role |
|---|---|
| `src/components/table-filter-panel.js` | UI component (tabs, sections, active chips) |
| `src/styles/table-filter-panel.css` | Panel styles |
| `src/admin/table-filter.js` | Distribution wiring + `ADMIN_TABLE_FILTER` event |

### Distribution tabs

| Tab | Contents |
|---|---|
| **Filter** | Category checkboxes, fixed column visibility |
| **Sort** | Product order (name, category, LTA) |
| **Bars** | Bar column show/hide |

Dropdown uses `--radius-lg` and `--shell-shadow`.

### Active filters footer

Applied filters appear **above Reset** as removable rows (×). Aggregates across all tabs.

### Panel integration checklist

1. Listen for `ADMIN_TABLE_FILTER` in your panel
2. Register config via `table-filter.js` / `initTableFilterTopbar().syncRoute()`
3. Use `tableFilterIsActive()` pattern for topbar dot state
4. Mark filterable rows with `[data-pid]` for product search integration

---

## 7. Product search

Component: `src/components/product-search.js`  
Topbar wiring: `src/admin/global-search.js`

- Emits `ADMIN_PRODUCT_FILTER` with `{ query, productId }`
- Generic row filter: `applyGenericProductFilter()` hides `[data-pid]` rows
- Topbar input: pill shape, `--topbar-h` height, 13px font
- Drawer input: same pill treatment under `.sheet--admin-full`
- Dropdown: `.product-search-list` — `--radius-lg`, `--shell-shadow`

**Rule:** one search component everywhere; do not build panel-specific product pickers in the topbar.

---

## 8. Data grid (Distribution pattern)

Use for any **product × dimension** matrix (products × bars, products × days, etc.).

> **Note:** Grid/table cell styling predates the floating-shell refresh and may be updated separately. Shell, topbar, and filter integration follow this guide.

### Structure

```html
<div class="dist-panel">
  <div class="dist-grid-wrap">
    <table class="dist-grid">
      <thead><!-- sticky header --></thead>
      <tbody>
        <tr class="dist-cat-row"><!-- sticky category --></tr>
        <tr data-pid="…"><!-- product row --></tr>
      </tbody>
    </table>
  </div>
</div>
```

### Key behaviours

| Feature | Implementation |
|---|---|
| Sticky product column | `.dist-sticky` + `--col-*-left` offsets via `src/admin/dist-columns.js` |
| Sticky header | `thead th { position: sticky; top: 0 }` |
| Sticky category rows | `.dist-cat-pinned` at `top: var(--dist-thead-h)` |
| Horizontal scroll hint | `.dist-grid-wrap.is-scrollable` gradient |
| Column show/hide | `hiddenColumns` in filter state → `colVisible()` |
| Product search | `[data-pid]` on rows, `.dist-prod-name` for text match |

### Column width tokens (panel-local)

```css
.dist-panel {
  --dist-product-w: 200px;
  --dist-pack-w: 68px;
  --dist-opening-w: 56px;
  --dist-lta-w: 92px;
  --dist-bar-w: 76px;
  --dist-thead-h: 44px;
}
```

### Cells

| State | Class | UI |
|---|---|---|
| On menu | `.dist-cell--on` | Pill input (`.dist-pill-input`) + remove (×) |
| Off menu | `.dist-cell--off` | Add button (`.dist-cell-add`, plus icon) |
| LTA badge | `.lta-badge` + `.lta-ok` / `.lta-neutral` / `.lta-over` | Pill, tabular nums |

### Category header row

- Spans sticky left cell (`.dist-cat-pinned`) + scroll filler (`.dist-cat-scroll`)
- Background `var(--secondary)`; hidden when all child products filtered out

---

## 9. List panels & drawer (Deliveries pattern)

Reference: `src/admin/panels/deliveries.js`

### List page

```html
<div class="admin-page del-panel">
  <p class="del-panel-lead muted">…</p>
  <div class="del-list">…</div>
</div>
```

| Element | Style |
|---|---|
| `.del-card` | Shell-radius card, subtle shadow, hover lift |
| `.del-empty` | Dashed `.admin-empty` treatment |
| Row actions | `.topbar-tool` icon buttons |

### Drawer form

Open with `openSheet({ variant: 'admin-full', … })` from `src/components/sheet.js`.

| Region | Notes |
|---|---|
| Shell | `.sheet.sheet--admin-full` — floating panel inset from edges, `--shell-radius`, backdrop scrim |
| Head / foot | Match topbar typography; subtle dividers |
| Body | Tinted background; `.admin-drawer-form` field stack |
| Inputs | `.admin-input`, `.admin-select`, `.admin-textarea` — 8px radius, light shadow |
| Grouped fields | `.admin-drawer-panel` — bordered sub-surface (product composer) |
| Buttons | `.admin-drawer-btn` (+ `--primary` for Save) |
| Line cards | `.del-line-card` inside committed products list |

---

## 10. Forms & inputs

### Admin form tokens

| Class | Use |
|---|---|
| `.admin-field` | Label + control stack |
| `.admin-label` | 10px uppercase muted label |
| `.admin-input` / `.admin-select` / `.admin-textarea` | Standard controls, `--topbar-h` for single-line |
| `.admin-drawer-btn` | Dashed secondary actions (attach photo, add line) |
| `.admin-drawer-btn--primary` | Solid save/submit |

Focus ring: `box-shadow: 0 0 0 2px rgb(24 24 27 / 0.06)`; border `var(--muted-foreground)`.

### Fraction input

`src/components/fraction-input.js` — WYSIWYG fractions for recipes; see README principle §2.

### In-grid numeric entry

Distribution allocation inputs: `.dist-pill-input` — borderless, centered, `inputmode="decimal"`, width grows with `ch` units.

---

## 11. Feedback & overlays

| Component | File | Use |
|---|---|---|
| Toast | `$('toast')` / `toast()` in `lib/util.js` | Short confirmations; `--radius-lg` + shell shadow in admin |
| Sheet | `src/components/sheet.js` | Admin drawer: `variant: 'admin-full'` |

Toolbar skeleton actions should toast “coming soon” until implemented (`topbar-toolbar.js`).

---

## 12. Spacing rhythm

| Gap | Use |
|---|---|
| `12px` | Viewport inset (`--sidebar-gap`); between major regions |
| `10px` | Between topbar strips; sidebar inner padding |
| `8px` | Nav item gap; panel internal gaps |
| `6px` | Compact panel padding (filter groups) |
| `2px` | Tight stacks (filter options, toolbar button gap) |

Content padding: `.admin-content` → `16px` (distribution grid uses `:has(.dist-panel)` for full-bleed).

---

## 13. Z-index stack

| Layer | z-index |
|---|---|
| Sidebar | 30 |
| Topbar | 20 |
| Product search dropdown | 100 |
| Topbar menus | 120 |
| Filter dropdown (`.tfp-dropdown`) | 130 |
| Drawer backdrop (`body::before`) | 199 |
| Admin drawer (`.sheet--admin-full`) | 200 |
| Toast | 200+ |

Sticky grid: header `3–5`, category rows `3–4`, product column `2`.

---

## 14. Building a new admin panel

### Minimal steps

1. **Route** — add panel name to `src/admin/router.js` and sidebar link(s) in `admin.html`
2. **Panel module** — `src/admin/panels/your-panel.js` exporting render + mount
3. **Register** — wire in `src/admin/panels/index.js` (`PANEL_TITLES`, switch)
4. **Topbar** — add `PANEL_TOOLBAR` strips; table panels also need filter config
5. **Markup** — wrap in `.admin-page`; use `.admin-surface` / `.admin-empty` for cards and empty states
6. **Styles** — extend `admin.css` with a prefixed block (e.g. `.opening-panel { … }`); reuse shell tokens
7. **Icons** — Lucide only; register new icons in `lib/icons.js`
8. **Search** — rows need `[data-pid]` if product filter should apply
9. **Drawer** — use `openSheet({ variant: 'admin-full' })` + admin form classes

### Do

- Reuse floating shell tokens (`--shell-radius`, `--shell-shadow`)
- Reuse `ProductSearch`, `table-filter-panel`, toolbar strips, grid sticky patterns
- Use secondary fills for hover/active nav — reserve solid `--primary` for CTAs
- Use `color-mix()` for subtle hovers and tinted content backgrounds
- Emit custom events for cross-panel state (`ADMIN_TABLE_FILTER`, `ADMIN_PRODUCT_FILTER`, `ADMIN_TOOLBAR_ACTION`)

### Don't

- Add new icon libraries or per-panel search inputs
- Wrap primary CTAs in bordered `.topbar-toolbar` strips (use `primary: true` item alone in strip)
- Put product search in the sidebar (topbar only)
- Build accordion-heavy filter UIs — use tabbed compact sections (Filter / Sort / …)
- Inline one-off colours — extend tokens if a semantic colour is needed app-wide

---

## 15. File map (admin UI)

```
v5/
  admin.html
  STYLEGUIDE.md          ← this file
  src/
    admin/
      main.js            Shell boot
      sidebar.js         Workspace switcher, collapsible nav
      router.js          Routes + nav active state
      global-search.js   Topbar ProductSearch
      topbar-toolbar.js  Icon strips + primary CTAs
      table-filter.js    Filter panel wiring
      dist-columns.js    Grid sticky/visibility math
      panels/
        distribution.js  Grid reference panel
        deliveries.js    List + drawer reference panel
        index.js         Panel registry
    components/
      product-search.js
      table-filter-panel.js
      sheet.js
      fraction-input.js
    lib/
      icons.js           Lucide helpers
      util.js            toast, $, escapeHtml
    styles/
      v5.css             Shared tokens
      admin.css          Admin shell, surfaces, drawer, grid
      table-filter-panel.css
```

---

## 16. Changelog

| Date | Notes |
|---|---|
| 2026-06 | Initial guide from Distribution panel |
| 2026-06-27 | Floating shell redesign: sidebar workspace switcher, collapsible sections, main `.admin-shell`, page surfaces, pill search, primary topbar CTAs, admin drawer (`sheet--admin-full`), Deliveries as list/drawer reference |

When you add a new reusable pattern, update this file and the reference panel.
