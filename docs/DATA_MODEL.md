# Data Model

## Top-Level Storage

`localStorage` key: `measured_stock_app`

```js
appData = {
  currentEventId: "abc123",   // ID of the active event
  events: {
    "abc123": { ...state },   // one entry per event
    "def456": { ...state },
  }
}
```

`state` is a live reference into `appData.events[currentEventId]`. Modifying `state` modifies the event directly.

---

## The `state` Object

```js
state = {
  // ── Identity ──────────────────────────────────────────
  id:         "abc123",               // string — unique event ID (uid())
  showName:   "Highlights 2025",      // string — event display name
  showDates:  "29 May, 30 May, 1 Jun",// string — comma-separated date list
                                       //   (generated from date pickers, not entered manually)

  // ── Setup lists ───────────────────────────────────────
  bars:       ["Bone Yard", "Bar 1"], // string[]
  suppliers:  [                       // {name, sor}[]
    { name: "Jubel", sor: 30 },       //   sor = sale-or-return % (0–100)
  ],
  recipients: ["Production", "Fred"], // string[] — internal transfer targets
  categories: ["BEER","CIDER","WINE","RTDs","SPIRITS","SOFTS","SELTZERS"], // string[]

  // ── Products ──────────────────────────────────────────
  products: [
    {
      id:          "p1",              // string — unique product ID
      name:        "Jubel Peach",     // string
      category:    "BEER",            // string — must match a value in categories[]
      supplier:    "Jubel",           // string — must match a supplier name
      sku:         "JBL001",          // string — optional SKU code
      size:        "12 x 440ml Cans", // string — pack size description
      unitsPerSku: 12,                // number — individual units per case/SKU
      qtyOrdered:  77,                // number — cases/SKUs ordered
      orderPrice:  17.50,             // number — £ per SKU
      arrival:     "Wednesday",       // string — arrival day label
    }
  ],

  // ── Opening Stock ─────────────────────────────────────
  // Keyed by product ID
  opening: {
    "p1": {
      invoiceQty:    77,   // number — qty on supplier invoice
      deliveredQty:  77,   // number — qty actually received from supplier
      alreadyInStock: 0,   // number — qty already on site before delivery (not from this invoice)
                           //   INCLUDED in openingStock but EXCLUDED from variance check
      damagedQty:    0,    // number — unusable units
      openingStock:  77,   // number — deliveredQty + alreadyInStock - damagedQty (auto-calculated)
    }
  },

  // ── Distribution ──────────────────────────────────────
  // Keyed by product ID, then bar name
  distribution: {
    "p1": {
      "Bone Yard": 18,
      "Bar 1":     14,
      // ...one entry per bar
    }
  },

  // ── Stock Counts ──────────────────────────────────────
  counts: [
    {
      id:       "cnt1",                     // string — unique count ID
      name:     "Friday Evening Count",     // string — session label
      bar:      "All Bars",                 // string — bar name or "All Bars"
      date:     "29 May 2025 20:00",        // string — display date
      savedAt:  "2025-05-29T20:00:00.000Z", // ISO string
      data: {
        "p1": {
          "Bone Yard": { cases: 6, singles: 8 },
          "Bar 1":     { cases: 5, singles: 4 },
          // ...one entry per bar
        }
      }
    }
  ],

  // ── Transfers ─────────────────────────────────────────
  transfers: [
    {
      id:        "tf1",                  // string — unique transfer ID
      recipient: "Production",           // string — must match a recipients[] entry
      unit:      "cases",                // "cases" | "units"
      lines: [
        {
          productId:   "p1",             // string — product ID
          productName: "Jubel Peach",    // string — denormalised name for display
          qty:         3,                // number
        }
      ],
      timestamp: "29 May 2025 14:30",   // string — display timestamp
    }
  ],

  // ── Closing Stock ─────────────────────────────────────
  // Keyed by product ID
  closing: {
    "p1": {
      closeCount:    6,   // number — final physical count (in SKUs/cases)
      returnAmount:  6,   // number — SKUs being returned to supplier
      carriedOver:   0,   // number — SKUs kept for next event
    }
  },
}
```

---

## Derived / Calculated Values

These are never stored — they are computed on render:

| Value | Where calculated | Formula |
|---|---|---|
| `openingStock` | `renderOpening()` | `deliveredQty - damagedQty` |
| `variance` | `renderOpening()` | `deliveredQty - invoiceQty` |
| `leftToAllocate` | `renderDistribution()` | `openingStock - sum(distribution[pid])` |
| `consumed` | `renderSummary()` | `openingStock - closingCount - transfersOut` |
| `maxReturnable` | `renderClosing()` | `invoiceQty × (sor / 100)` |
| `consumedCost` | `renderSummary()` | `consumed × orderPrice` |

---

## ID Generation

```js
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
```

Used for event IDs, product IDs, count IDs, transfer IDs.

---

## Category Colours

Used in `catBadge()` to render coloured pills in tables:

```js
const cls = {
  BEER:     'beer',
  CIDER:    'cider',
  WINE:     'wine',
  RTDs:     'rtd',
  SPIRITS:  'spirits',
  SOFTS:    'softs',
  SELTZERS: 'softs',   // shares the softs colour
}[cat] || 'rtd';       // fallback for custom categories
```

CSS variables for each: `--beer`, `--cider`, `--wine`, `--rtd`, `--softs`, `--spirits`.
