# Measured Stock — Authentication

Supabase Auth (Google + email/password) with invite-only profiles.

**Email / Postmark is optional.** Admins create an **invite link** in Users; recipients finish on `/onboard` with their own password.

## Minimum setup (no mail)

### 1. Auth providers

Supabase → Authentication → Providers:

- Enable **Email** (password)
- Enable **Google** (Client ID + Secret from Google Cloud Console)

Redirect / Site URL allow list:

- `https://measured-stock.vercel.app/login`
- `https://measured-stock.vercel.app/onboard`
- `https://measured-stock.vercel.app/**`
- `https://localhost:5173/login` (local Vite)
- `https://localhost:5173/onboard`

**Site URL must be** `https://measured-stock.vercel.app`  
(not `http://localhost:3000` — that breaks invite tokens)

Optional Vercel env to force redirects:

```
APP_URL=https://measured-stock.vercel.app
```

Tip: under Auth → Providers → Email, you can turn **off** “Confirm email” while mail is not configured, so password users are not blocked waiting for a message.

### 2. Vercel env (already partly set)

```
COOKIE_SECRET=...            # edge session cookie (HMAC) — already on project
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...     # server only — already on project
```

Not required yet:

```
POSTMARK_SERVER_TOKEN=...
POSTMARK_FROM_EMAIL=live@measured.events
```

### 3. First admin (setup wizard)

With **zero** active admins, open:

**https://measured-stock.vercel.app/setup**

Enter name, email, and password → creates the first **active admin** and signs you in.

After that, `/setup` closes automatically. Teammates: **Users → Add user → Create invite link**.

SQL escape hatch (still works):

```sql
SELECT public.promote_profile_admin('you@example.com');
```

### Adding teammates (no email)

**Admin → Users → Add user → Create invite link**

- Creates an **active** account
- Shows a **copyable Measured Stock link** (no email, no `supabase.co` URL):
  `https://measured-stock.vercel.app/onboard?invite=inv1.…`
- Recipient opens the link → name + password → into the app
- Old Supabase `…/auth/v1/verify?…` links no longer work for onboarding — create a fresh invite

## Later: Postmark (optional)

When you’re ready:

1. Verify DKIM on your sending domain (e.g. `measured.events`) at your DNS host — not on `*.vercel.app`.
2. Supabase Auth → SMTP → Postmark (`smtp.postmarkapp.com`, port 587).
3. Set `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM_EMAIL` on Vercel.
4. Create templates `auth-account-approved` / `auth-invite` if you want automated mail.

Activation already works without Postmark; mail is best-effort when the token is present.

## Flow

1. `/login` — Google OAuth or email/password  
2. Client POSTs access token to `/api/auth/session` → `ms_auth` role cookie  
3. PostgREST uses the user JWT  
4. RLS: `is_active_user()` / `is_admin()`; anon denied  
