# Panels

Each panel is a `<div id="panel-{name}" class="panel">` in `index.html`. Only the panel with the `active` class is visible. Switching is handled by `showPanel(name)` in `app.js`.

---

## Setup (`#panel-setup`)

**Purpose:** Configure everything about the current event before it starts.

**Sections:**
- **Stat cards** — live counts of products, bars, suppliers, count sessions
- **Current Event** — event name input + start/end date pickers (generates comma-separated `state.showDates`)
- **Bar Names** — add/remove/rename bars (stored in `state.bars[]`)
- **Suppliers** — add/remove suppliers with SOR% (stored in `state.suppliers[]`)
- **Internal Transfer Recipients** — people/teams who receive internal transfers (stored in `state.recipients[]`)
- **Product Categories** — custom category names (stored in `state.categories[]`)
- **Data & Backup** — export/import event as JSON, load sample data
- **Cloud Sync** — Supabase URL + anon key, connect/disconnect, SQL setup instructions

**Key functions:** `updateShowName()`, `updateShowDates()`, `addBar()`, `addSupplier()`, `addCategory()`, `addRecipient()`, `loadSampleData()`, `exportData()`, `importData()`, `connectCloud()`

---

## Products (`#panel-products`)

**Purpose:** Register all products/SKUs that will be used at the event.

**Features:**
- Search by name, filter by category
- Add/edit/delete products via modal
- Import from Excel template (SheetJS)
- Download blank Excel import template
- Products are displayed in a table grouped by category

**Key functions:** `renderProducts()`, `openAddProduct()`, `editProduct(id)`, `saveProduct()`, `deleteProduct(id)`, `importProductsFile()`, `confirmImport()`, `downloadImportTemplate()`

**Modal:** `#productModal` — fields: name, category, supplier, SKU, pack size, units per SKU, qty ordered, order price, arrival day

---

## Opening Stock (`#panel-opening`)

**Purpose:** Record what was actually delivered vs what was ordered. Sets the opening inventory for the event.

**Columns:** Product, Pack Size, Qty Ordered, Invoice Qty, Delivered Qty, Variance, Damaged, Opening Stock

**How it works:**
- One row per product
- User enters `invoiceQty` and `deliveredQty`; `damagedQty` is optional
- `openingStock = deliveredQty - damagedQty` (auto-calculated, displayed read-only)
- `variance = deliveredQty - invoiceQty` (colour-coded: green = over, red = short)
- Auto-saves on input; Save button forces a full save

**Key functions:** `renderOpening()`, `saveOpening()`

---

## Distribution (`#panel-distribution`)

**Purpose:** Allocate opening stock from the central store out to each bar.

**How it works:**
- Table has one row per product, one column per bar
- User enters how many SKUs/cases to send to each bar
- "Left to Allocate" column shows `openingStock - sum(allocations)` in real time
- Goes red if over-allocated

**Key functions:** `renderDistribution()`, `saveDistribution()`

---

## Stock Counts (`#panel-counts`)

**Purpose:** Record mid-event or end-of-day physical stock counts at bars.

**How it works:**
- Create a named count session (e.g. "Friday Evening")
- Choose a specific bar or "All Bars"
- For each product, enter cases and singles at the bar
- Multiple sessions can be saved; they appear in a list
- Sessions are stored in `state.counts[]`

**Key functions:** `renderCountSessions()`, `openNewCountSession()`, `startCountSession()`, `saveCurrentCount()`, `loadCountSession(id)`, `closeCountSession()`

**Modal:** `#countModal` — fields: session name, bar selector

---

## Transfers (`#panel-transfers`)

**Purpose:** Log internal movements of stock (e.g. to artist areas, production, VIP).

**How it works:**
- Select a recipient from `state.recipients[]`
- Toggle between "Cases" and "Units" mode
- Add product lines with quantity
- "Log Transfer" saves to `state.transfers[]` with a timestamp
- Transfer log shows all historical transfers with delete option

**Key functions:** `renderTransfers()`, `addTransferLine()`, `setTransferUnit()`, `logTransfer()`, `clearTransferForm()`, `deleteTransfer(id)`

---

## Closing Stock (`#panel-closing`)

**Purpose:** Record the final stock count at the end of the event and calculate supplier returns.

**Columns:** Product, Supplier, SOR%, Invoice Qty, Full Close Count, Max Returnable (Invoice × SOR%), Return Amount, Carried Over

**How it works:**
- `closeCount` = physical count of remaining stock
- `maxReturnable = invoiceQty × (sor / 100)` — capped return limit
- `returnAmount` = user enters how many to actually return (capped at maxReturnable)
- `carriedOver = closeCount - returnAmount`

**Key functions:** `renderClosing()`, `saveClosing()`

---

## Summary (`#panel-summary`)

**Purpose:** End-of-event overview — consumed stock, costs, and returns by supplier.

**Sections:**

**Stat cards (top):**
- Total products
- Total SKUs consumed
- Total stock cost consumed (£)
- Total SKUs returned

**Stock Movement table:**
- One row per product
- Columns: Opening, Distributed, Transfers Out, Closing Count, Consumed, Return Amount
- `consumed = openingStock - closingCount - transfersOut`

**Returns by Supplier table:**
- Aggregated by supplier
- Columns: Total Ordered, Consumed, Consumed Cost (£), Max Returns

**Key functions:** `renderSummary()`

---

## Modals

| ID | Trigger | Purpose |
|---|---|---|
| `#productModal` | `openAddProduct()` / `editProduct()` | Add or edit a product |
| `#countModal` | `openNewCountSession()` | Create a new stock count session |
| `#importModal` | Excel file selected in Products panel | Preview and confirm Excel import |

All modals use `.modal-overlay` + `.modal` classes. Show by adding class `show` to the overlay. Hide by removing `show`.
