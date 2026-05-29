# Measured STOCK

A festival bar stock management web app. Fully static — no build step, no framework, no server-side code. Drop the folder on any web server and it runs.

---

## Project Structure

```
measured-stock/
├── index.html                 # All HTML markup — one page, multiple panels
├── assets/
│   ├── css/
│   │   └── style.css          # All styles — shadcn/ui design system
│   ├── js/
│   │   └── app.js             # All application logic
│   └── img/
│       └── logo.png           # Measured logo (transparent PNG)
├── README.md                  # This file
└── docs/
    ├── ARCHITECTURE.md        # How the app is structured
    ├── DATA_MODEL.md          # The state object and data shapes
    └── PANELS.md              # Each panel/screen documented
```

---

## Quick Start

Open `index.html` in a browser. On first load it auto-populates with sample festival data so every panel has something to look at.

For multi-device sync, connect a Supabase project in the Setup panel (see Setup → Cloud Sync).

---

## Tech Stack

- **HTML/CSS/JS** — vanilla, no framework
- **Font** — Outfit (Google Fonts)
- **Design system** — shadcn/ui tokens (zinc palette, 4px radius)
- **Excel import/export** — SheetJS (loaded from CDN)
- **Cloud sync** — Supabase REST API (optional)
- **Storage** — `localStorage` for offline-first persistence

---

## Deployment

Upload the entire `measured-stock/` folder to your web server. No build step required.

```bash
# Example: rsync to a server
rsync -avz measured-stock/ user@yourserver.com:/var/www/html/stock/

# Example: Netlify drag-and-drop
# Just drag the measured-stock/ folder onto netlify.com/drop
```

The app works over `file://` locally and over `http://` / `https://` on a server.

---

## Making Changes

See `docs/ARCHITECTURE.md` for a full guide on how to edit the app.
