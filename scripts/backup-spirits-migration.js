#!/usr/bin/env node
// =====================================================================
// backup-spirits-migration.js
// Snapshot every table migration 034 touches, before applying it.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backup-spirits-migration.js
//
// Writes: backup/pre-034-spirits-bottle-units-<YYYY-MM-DD>.json
// =====================================================================

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sb } from '../lib/supabase-admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SPIRIT_FILTER = [
  'category.colour_key=eq.spirits',
  'case_size=like.\\d*x*',
].join('&');

async function all(table, query) {
  const rows = await sb.get(table, query);
  return Array.isArray(rows) ? rows : [];
}

async function spiritProducts() {
  const products = await all(
    'products',
    '?select=*,category:categories(colour_key)&category.colour_key=eq.spirits&order=name'
  );
  return products.filter((p) => {
    const cs = String(p.case_size || '').toLowerCase();
    if (!/^\d+\s*x\s*\d/.test(cs.trim())) return false;
    if (/x\s*250|x\s*330|x\s*200|x\s*275/.test(cs)) return false;
    return true;
  });
}

async function main() {
  const products = await spiritProducts();
  const ids = products.map((p) => p.id);
  const names = [...new Set(products.map((p) => p.name.trim().toLowerCase()))];
  if (!ids.length) {
    console.log('No multi-pack spirit products found — nothing to back up.');
    return;
  }

  const inList = ids.map((id) => encodeURIComponent(id)).join(',');
  const pidQ = `product_id=in.(${inList})`;

  const recipeRows = await all('recipe_ingredients', '?select=*&pool_name=is.null&product_name=not.is.null');
  const recipe_ingredients = recipeRows.filter((ri) =>
    names.includes(String(ri.product_name || '').trim().toLowerCase())
  );

  const backup = {
    exported_at: new Date().toISOString(),
    migration: '034_spirits_bottle_units',
    product_count: products.length,
    products,
    product_suppliers: await all('product_suppliers', `?select=*&${pidQ}`),
    event_products: await all('event_products', `?select=*&${pidQ}`),
    distribution: await all('distribution', `?select=*&${pidQ}`),
    stock_count_lines: await all('stock_count_lines', `?select=*&${pidQ}`),
    closing_stock: await all('closing_stock', `?select=*&${pidQ}`),
    delivery_lines: await all('delivery_lines', `?select=*&${pidQ}`),
    transfer_lines: await all('transfer_lines', `?select=*&${pidQ}`),
    wastage_lines: await all('wastage_lines', `?select=*&${pidQ}`),
    topup_lines: await all('topup_lines', `?select=*&${pidQ}`),
    warehouse_stock: await all('warehouse_stock', `?select=*&${pidQ}`),
    supplier_return_lines: await all('supplier_return_lines', `?select=*&${pidQ}`),
    recipe_ingredients,
  };

  mkdirSync(join(ROOT, 'backup'), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const out = join(ROOT, 'backup', `pre-034-spirits-bottle-units-${date}.json`);
  writeFileSync(out, JSON.stringify(backup, null, 2));

  console.log(`Backup written: ${out}`);
  console.log(`Products: ${backup.product_count}`);
  for (const [k, v] of Object.entries(backup)) {
    if (Array.isArray(v)) console.log(`  ${k}: ${v.length} rows`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
