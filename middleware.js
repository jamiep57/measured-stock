import { COOKIE_NAME, getAuthCookie, verifyAuthToken } from './lib/cookie.js';

/** @param {string | null} error */
function loginPage(error) {
  const msg =
    error === 'invalid'
      ? 'Incorrect PIN. Try again.'
      : error === 'config'
        ? 'App is not configured yet. Contact your administrator.'
        : 'Enter your 4-digit PIN to continue.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Measured Stock — Sign in</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Outfit, system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafafa;
      color: #18181b;
      padding: 1.5rem;
    }
    .card {
      width: 100%;
      max-width: 22rem;
      background: #fff;
      border: 1px solid #e4e4e7;
      border-radius: 4px;
      padding: 2rem;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
    }
    h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 0.25rem; }
    p { font-size: 0.875rem; color: #71717a; margin-bottom: 1.5rem; line-height: 1.5; }
    p.error { color: #dc2626; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
    input {
      width: 100%;
      font: inherit;
      font-size: 1.5rem;
      letter-spacing: 0.35em;
      text-align: center;
      padding: 0.75rem 1rem;
      border: 1px solid #e4e4e7;
      border-radius: 4px;
      outline: none;
    }
    input:focus { border-color: #18181b; box-shadow: 0 0 0 2px rgb(24 24 27 / 0.1); }
    button {
      margin-top: 1rem;
      width: 100%;
      font: inherit;
      font-weight: 500;
      padding: 0.625rem 1rem;
      background: #18181b;
      color: #fafafa;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: #27272a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Measured Stock</h1>
    <p class="${error ? 'error' : ''}">${msg}</p>
    <form method="POST" action="/api/unlock" autocomplete="off">
      <label for="pin">PIN</label>
      <input
        id="pin"
        name="pin"
        type="password"
        inputmode="numeric"
        pattern="[0-9]{4}"
        maxlength="4"
        minlength="4"
        required
        autofocus
        placeholder="••••"
      />
      <button type="submit">Unlock</button>
    </form>
  </div>
</body>
</html>`;
}

export default async function middleware(request) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    return new Response(loginPage('config'), {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const cookie = getAuthCookie(request.headers.get('cookie'));
  if (cookie && (await verifyAuthToken(secret, cookie))) {
    return;
  }

  const url = new URL(request.url);
  return new Response(loginPage(url.searchParams.get('error')), {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export const config = {
  matcher: ['/((?!api/unlock).*)'],
};
