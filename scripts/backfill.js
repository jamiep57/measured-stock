#!/usr/bin/env node
// =====================================================================
// scripts/backfill.js
// =====================================================================
// One-shot seed of the v2 relational tables from the existing
// stock_events blobs. Use this once per Supabase project (dev, then
// prod) immediately after applying migrations/00*.sql.
//
// Run:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_KEY=<service-role-jwt> \
//     node scripts/backfill.js
//
// Or put the same values in a local .env file (NOT committed — see
// .gitignore) and the script will pick them up via dotenv-style parse.
//
// What it does:
//   1. Calls syncRecipes() once
//   2. Calls syncEvent(id) for each legacy event id in SCOPE
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tiny .env loader (no extra dep). Honour-system parse: ignore comments,
// trim, strip surrounding quotes.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
for (const file of ['.env', '.env.local']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] != null) continue; // shell wins
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

// Pick the effective Supabase target (same precedence as supabase-admin.js).
const TARGET_URL = (
  process.env.SYNC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ''
);
const TARGET_KEY = (
  process.env.SYNC_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
);
if (!TARGET_URL || !TARGET_KEY) {
  console.error('[backfill] Missing Supabase target credentials.');
  console.error('  Set SYNC_SUPABASE_URL + SYNC_SUPABASE_SERVICE_KEY in .env.local');
  console.error('  (or SUPABASE_URL + SUPABASE_SERVICE_KEY).');
  process.exit(2);
}

// Defer import until after env is in place
const { syncEvent, syncRecipes } = await import('../lib/sync-engine.js');

const SCOPE = (process.env.SYNC_SCOPE ||
  'mo95nl29jb46o,mpbb01nnvy0t7,__recipes__'
).split(',').map(s => s.trim()).filter(Boolean);

console.log(`[backfill] target = ${TARGET_URL}`);
console.log(`[backfill] scope  = ${SCOPE.join(', ')}`);

const start = Date.now();
let okCount = 0, errCount = 0;
for (const id of SCOPE) {
  const t0 = Date.now();
  try {
    let res;
    if (id === '__recipes__') {
      res = await syncRecipes();
    } else if (id === '__bugs__') {
      console.log(`[backfill] ${id}: skipped (bugs sync not implemented)`);
      continue;
    } else {
      res = await syncEvent(id);
    }
    const ms = Date.now() - t0;
    console.log(`[backfill] ${id}: OK (${ms}ms)`, JSON.stringify(res));
    okCount++;
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`[backfill] ${id}: FAILED (${ms}ms)`, err?.message || err);
    if (err?.stack) console.error(err.stack);
    errCount++;
  }
}
const totalMs = Date.now() - start;
console.log(`[backfill] done in ${totalMs}ms — ok=${okCount} err=${errCount}`);
process.exit(errCount ? 1 : 0);
