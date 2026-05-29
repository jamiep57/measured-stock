# Changelog

All versions of the Measured Stock System are documented here.
The version number is reflected in the HTML filename and `<title>` tag.

---

## v1.9
- **Category badges** — blank if the product's category doesn't exactly match a name configured in Setup → Product Categories
- Badge colour map updated to match the new canonical category names (Beer, Cider, Wine, Sparkling Wine, Spirit & Mixer, RTDs, Canned Cocktails, Hard Seltzer, Shots, Cocktails, Soft Drinks)

## v1.8
- **Stock Counts** — live count summary now refreshes immediately when a count session is saved
- `renderCountSummary()` called directly in `saveCurrentCount()` rather than relying solely on the `renderCountSessions()` chain

## v1.7
- **Stock Counts** — Download PDF button added to the live count summary
- PDF matches delivery note style: Measured logo brackets, event name, session name, print date/time, event progress %, at-risk rows highlighted in red, suggested order cases shown
- File saves as `count_summary_[session]_[date].pdf`

## v1.6
- **Stock Counts** — live count summary table added above the session list
- Summary reflects the currently open session only, across all bars
- Columns: Product, Pack Size, Opening Stock (Cases), Counted (Cases), Suggested Order
- Event progress % input: enter how far through the event you are (e.g. 35%)
- Suggested order = pro-rated consumption forecast — cases needed to return to the expected remaining stock level given current consumption rate
- At-risk rows highlighted red with ⚠ ORDER badge; on-track rows show green ✓
- Count entry cells: blank by default, blanks treated as zero on save

## v1.5
- **Opening Stock** — all products now shown regardless of qty ordered
- Blank cells by default — no auto-zero on invoice, delivered, already in stock, or damaged fields
- Category column added with colour-coded badge
- Products sorted by canonical category order then A–Z
- Unrecognised category or supplier displayed as blank

## v1.4
- **Transfer log** — pack size shown alongside product name in the product dropdown
- **Transfer log** — editable date and time fields added; defaults to now, can be backdated
- **Distribution** — pack size column added between Product and Opening Stock
- **Closing Stock** — pack size column added between Product and Supplier

## v1.3
- **Sticky table headers** — `thead th` uses `position: sticky; top: 0` relative to the `.table-wrap` scroll container, fixing frozen panes across all tabs
- Root cause of previous failures: any `overflow` property on a parent element creates a new scroll context that traps `position: sticky`; fixed by making `.table-wrap` the explicit scroll container with `overflow: auto; max-height: calc(100vh - 180px)`
- **Product sort order** — canonical category order applied across all panels: Beer → Cider → Wine → Sparkling Wine → Spirit & Mixer → RTDs → Canned Cocktails → Hard Seltzer → Shots → Cocktails → Soft Drinks, then A–Z within each category
- `sortedProducts()` utility function added; used in Products, Opening Stock, Distribution, Stock Counts, Closing Stock, Summary, and Transfer product dropdown
- Default categories in Setup updated to match canonical list

## v1.2
- Layout made full-width (removed `max-width: 1400px` from `main`)
- Font changed from Inter to Outfit throughout
- Border radius reduced from `0.5rem` to `0.25rem` across all elements
- File renamed to `Measured-Stock-System.html` with version suffix going forward
- Supabase migration tool (`supabase_migrate.html`) created as standalone file
- Sample data auto-loads on first launch (silent, no confirm prompt)
- `loadSampleData()` expanded with full opening stock, distribution, count session, transfers, and closing stock

## v1.1
- Project restructured from single HTML file into folder:
  - `Measured-Stock-System.html` — markup only
  - `assets/css/style.css` — all styles
  - `assets/js/app.js` — all application logic
  - `assets/img/logo.png` — Measured logo (black background converted to transparent PNG)
- Measured logo added to sidebar header
- `README.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/PANELS.md` created
- Event dates changed from free-text input to Start/End date pickers
- Date range automatically expands to comma-separated daily list
- Opening Stock: "Already in Stock" column added
  - Formula: `Opening Stock = Delivered + Already in Stock − Damaged`
  - Variance calculation unchanged (Delivered vs Invoiced only)

## v1.0
- Initial release as single HTML file (`bar_stock_manager.html`)
- Panels: Setup, Products, Opening Stock, Distribution, Stock Counts, Transfers, Closing Stock, Summary
- shadcn/ui design system (zinc palette, Outfit font, 4px radius)
- LocalStorage persistence with multi-event support
- Optional Supabase cloud sync with 8-second polling
- Excel product import via SheetJS with downloadable template
- Delivery note PDF generation on transfer log (jsPDF)
- Category order and sort: Beer, Cider, Wine, Sparkling Wine, Spirit & Mixer, RTDs, Canned Cocktails, Hard Seltzer, Shots, Cocktails, Soft Drinks
