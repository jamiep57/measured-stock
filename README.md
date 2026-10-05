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

## Access control (Supabase Auth)

The app uses **Supabase Auth** (Google + email/password) with invite-only profiles.
RLS denies anonymous access; only **active** profiles can read/write stock data.

See **[docs/AUTH.md](docs/AUTH.md)** for Google OAuth, Postmark SMTP, env vars, and promoting the first admin.

Edge gate (`middleware.js`) requires a signed `ms_auth` cookie issued by `/api/auth/session` after login. Set `COOKIE_SECRET` in Vercel.

---

## Deployment

Vercel build runs `v5` Vite then serves the repo root. Configure Auth + Postmark before cutover (see `docs/AUTH.md`).

---

## Making Changes

See `docs/ARCHITECTURE.md` for a full guide on how to edit the app.
