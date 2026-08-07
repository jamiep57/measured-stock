/**
 * Copy Vite build output from v5/dist to the repo root for Vercel.
 * Never overwrites legacy index.html (V1 at /legacy).
 *
 * Also replaces source shells under v5/ with redirect stubs so Vercel
 * clean-URLs cannot keep serving /v5/admin from v5/admin.html.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dist = path.join(repoRoot, 'v5', 'dist');
const v5Dir = path.join(repoRoot, 'v5');

if (!fs.existsSync(dist)) {
  console.error('Missing v5/dist — run vite build first');
  process.exit(1);
}

for (const name of fs.readdirSync(dist)) {
  if (name === 'index.html') {
    console.warn('skipping dist/index.html to protect legacy /index.html');
    continue;
  }
  const src = path.join(dist, name);
  const dest = path.join(repoRoot, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

function redirectStub(to) {
  const safe = String(to).replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${safe}">
  <link rel="canonical" href="${safe}">
  <title>Redirecting…</title>
  <script>location.replace(${JSON.stringify(to)});</script>
</head>
<body>
  <p>Moved to <a href="${safe}">${safe}</a>.</p>
</body>
</html>
`;
}

// On Vercel only: stub source shells so clean URLs cannot keep serving /v5/*.
// Locally we leave v5/*.html alone so Vite can keep building from them.
if (process.env.VERCEL) {
  fs.writeFileSync(path.join(v5Dir, 'admin.html'), redirectStub('/'));
  fs.writeFileSync(path.join(v5Dir, 'scan.html'), redirectStub('/scan'));
  fs.writeFileSync(path.join(v5Dir, 'app.html'), redirectStub('/app/'));
  fs.writeFileSync(path.join(v5Dir, 'index.html'), redirectStub('/app/'));
}

fs.rmSync(dist, { recursive: true, force: true });
console.log(
  process.env.VERCEL
    ? 'Copied v5/dist → repo root; stubbed legacy /v5/*.html shells'
    : 'Copied v5/dist → repo root',
);
