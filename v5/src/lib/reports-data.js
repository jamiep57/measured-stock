/**
 * Reports data access: cross-event sales and loose stock allowances
 * (migration 072). Allowances are admin-only (RLS).
 */

import { getDB } from '../db.js';

const enc = (v) => encodeURIComponent(v);

export function isLooseSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(msg)
    && /loose_stock/i.test(msg);
}

/** Every event's till rows in the organisation (RLS-scoped), for "by event". */
export async function listSalesAllEvents() {
  const DB = getDB();
  const base = 'event_id,event:events(name,start_date)';
  try {
    return await DB.select('till_imports', `?select=${base},rows:till_sale_rows(items_sold,net_sales,gross_sales,category,location,sale_date)`);
  } catch (err) {
    if (!/location|sale_date|42703|PGRST/i.test(String(err?.message || err))) throw err;
    return DB.select('till_imports', `?select=${base},rows:till_sale_rows(items_sold,net_sales,gross_sales,category)`);
  }
}

export function listLooseAllowances(eventId) {
  return getDB().select('loose_stock_allowances', `?event_id=eq.${enc(eventId)}&select=*&order=created_at.asc`);
}

/**
 * Set (or clear with pct = null) the allowance for one product or category.
 * pct is a percentage of the loose singles, from 0 to 100.
 * @param {{ eventId: string, productId?: string, categoryId?: string, existing?: object|null, pct: number|null }} p
 */
export async function saveLooseAllowance({ eventId, productId = null, categoryId = null, existing = null, pct }) {
  const DB = getDB();
  if (pct == null) {
    if (existing?.id) await DB.remove('loose_stock_allowances', `id=eq.${enc(existing.id)}`);
    return null;
  }
  if (existing?.id) {
    const rows = await DB.update('loose_stock_allowances', `id=eq.${enc(existing.id)}`, { allowance_pct: pct });
    return rows?.[0] || { ...existing, allowance_pct: pct };
  }
  const rows = await DB.insert('loose_stock_allowances', {
    event_id: eventId,
    product_id: productId,
    category_id: categoryId,
    allowance_pct: pct,
  });
  return rows?.[0] || null;
}
