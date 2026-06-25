#!/usr/bin/env node
// =====================================================================
// Seed case_sizes from the product library and link products.case_size_id.
// Requires migration 036 (table) — run 037 SQL or this script for data.
//
//   node scripts/seed-case-sizes.js
//
// Uses the publishable anon key (same as the browser app). Optional env
// overrides: SUPABASE_URL, SUPABASE_ANON_KEY (or SYNC_* / V2_* variants).
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

for (const file of ['.env', '.env.local']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] != null) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

const BUILTIN = {
  url: 'https://qqdvzcaukstfdixnfuqq.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
};

const URL = (
  process.env.SUPABASE_URL ||
  process.env.V2_SUPABASE_URL ||
  process.env.SYNC_SUPABASE_URL ||
  BUILTIN.url
).replace(/\/$/, '');

const KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  BUILTIN.key;

function norm(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/×/g, 'x');
}

function normAlias(t) {
  const n = norm(t);
  if (n === '50l') return '50lkeg';
  if (n === '17.27') return '17.27l';
  return n;
}

/** Catalogue entries — mirrors migrations/037_seed_case_sizes.sql */
const CATALOGUE = [
  { label: '24×330ml', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 10 },
  { label: '24×330ml Cans', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 11 },
  { label: '12×330ml', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 20 },
  { label: '12×440ml Cans', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 21 },
  { label: '24×440ml Cans', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 22 },
  { label: '24×500ml Cans', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 23 },
  { label: '12×250ml', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 30 },
  { label: '12×250ml Cans', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 31 },
  { label: '24×250ml', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 32 },
  { label: '24×200ml', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 33 },
  { label: '24×150ml', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 34 },
  { label: '12×125ml Cans', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 35 },
  { label: '12×500ml', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 36 },
  { label: '12×1L', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 37 },
  { label: '8×1L', units_per_case: 8, stock_unit: 'case', servings_per_unit: 1, sort_order: 38 },
  { label: '4×1L', units_per_case: 4, stock_unit: 'case', servings_per_unit: 1, sort_order: 39 },
  { label: '4×1000ml', units_per_case: 4, stock_unit: 'case', servings_per_unit: 1, sort_order: 40 },
  { label: '4×2.5L', units_per_case: 4, stock_unit: 'case', servings_per_unit: 1, sort_order: 41 },
  { label: '5×1kg', units_per_case: 5, stock_unit: 'case', servings_per_unit: 1, sort_order: 50 },
  { label: '12×187ml Cans', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 60 },
  { label: '12×187ml PET', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 61 },
  { label: '16×750ml', units_per_case: 16, stock_unit: 'case', servings_per_unit: 30, sort_order: 62 },
  { label: '6×750ml', units_per_case: 6, stock_unit: 'case', servings_per_unit: 30, sort_order: 63 },
  { label: '12', units_per_case: 12, stock_unit: 'case', servings_per_unit: 1, sort_order: 64 },
  { label: '24', units_per_case: 24, stock_unit: 'case', servings_per_unit: 1, sort_order: 65 },
  { label: '70cl', units_per_case: 1, stock_unit: 'bottle', servings_per_unit: 28, sort_order: 70 },
  { label: '1L', units_per_case: 1, stock_unit: 'bottle', servings_per_unit: 40, sort_order: 71 },
  { label: '750ml', units_per_case: 1, stock_unit: 'bottle', servings_per_unit: 30, sort_order: 72 },
  { label: '6×700ml', units_per_case: 6, stock_unit: 'case', servings_per_unit: 28, sort_order: 73 },
  { label: '6×1L', units_per_case: 6, stock_unit: 'case', servings_per_unit: 40, sort_order: 74 },
  { label: '6', units_per_case: 6, stock_unit: 'case', servings_per_unit: 28, sort_order: 75 },
  { label: '50L Keg', units_per_case: 1, stock_unit: 'keg', servings_per_unit: 88, sort_order: 80 },
  { label: '30L Keg', units_per_case: 1, stock_unit: 'keg', servings_per_unit: 52, sort_order: 81 },
  { label: '9 Gal', units_per_case: 1, stock_unit: 'keg', servings_per_unit: 72, sort_order: 82 },
  { label: '20L KeyKeg', units_per_case: 1, stock_unit: 'keg', servings_per_unit: 35, sort_order: 83 },
  { label: '20Ltr BIB', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 84 },
  { label: '5L BIB', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 85 },
  { label: '10L', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 86 },
  { label: '20L', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 87 },
  { label: '150ml', units_per_case: 1, stock_unit: 'bottle', servings_per_unit: 6, sort_order: 90 },
  { label: '360ml', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 91 },
  { label: '1kg', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 92 },
  { label: '12kg', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 93 },
  { label: '1,000 Half Pint Cups', units_per_case: 1000, stock_unit: 'unit', servings_per_unit: null, sort_order: 94 },
  { label: '17.27L', units_per_case: 1, stock_unit: 'unit', servings_per_unit: null, sort_order: 95 },
];

async function api(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log(`[seed-case-sizes] target = ${URL}`);

  try {
    await api('case_sizes?select=id&limit=1');
  } catch (err) {
    if (err.status === 404 || /case_sizes/i.test(err.message)) {
      console.error('\n[seed-case-sizes] The case_sizes table does not exist yet.');
      console.error('  Run migrations/036_case_sizes.sql in Supabase SQL Editor first,');
      console.error('  then re-run this script (or run migrations/037_seed_case_sizes.sql).');
      process.exit(2);
    }
    throw err;
  }

  // Upsert catalogue (merge on unique label).
  const upserted = await api('case_sizes?on_conflict=label', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(CATALOGUE),
  });
  console.log(`[seed-case-sizes] upserted ${upserted.length} catalogue entries`);

  const byNorm = new Map();
  for (const row of upserted) {
    byNorm.set(norm(row.label), row);
  }
  // Re-fetch all in case merge didn't return every row.
  const allSizes = await api('case_sizes?select=id,label,units_per_case,stock_unit');
  for (const row of allSizes) byNorm.set(norm(row.label), row);

  const products = await api(
    'products?select=id,name,case_size,case_size_id,stock_unit,units_per_case&case_size=not.is.null'
  );

  let linked = 0;
  let skipped = 0;
  const unmatched = new Set();

  for (const p of products) {
    const cs = String(p.case_size || '').trim();
    if (!cs) continue;
    const key = normAlias(cs);
    const cat = byNorm.get(key);
    if (!cat) {
      unmatched.add(cs);
      skipped++;
      continue;
    }
    const patch = {
      case_size_id: cat.id,
      case_size: cat.label,
    };
    if (!p.stock_unit) patch.stock_unit = cat.stock_unit;
    if (cat.stock_unit === 'case' && (!p.units_per_case || Number(p.units_per_case) <= 0)) {
      patch.units_per_case = cat.units_per_case;
    }
    await api(`products?id=eq.${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    linked++;
  }

  console.log(`[seed-case-sizes] linked ${linked} products, skipped ${skipped}`);
  if (unmatched.size) {
    console.log('[seed-case-sizes] unmatched case_size values:');
    [...unmatched].sort().forEach((s) => console.log(`  - ${s}`));
  }
  console.log('[seed-case-sizes] done.');
}

main().catch((err) => {
  console.error('[seed-case-sizes] failed:', err.message || err);
  process.exit(1);
});
