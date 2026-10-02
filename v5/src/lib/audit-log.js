/**
 * Human-readable summaries for public.audit_log rows (migration 066).
 */

export const AUDIT_TABLE_LABELS = {
  products: 'Product',
  product_suppliers: 'Supplier offer',
  events: 'Event',
  event_products: 'Event product / order',
  distribution: 'Allocation',
  bar_products: 'Bar menu',
  deliveries: 'Delivery',
  delivery_lines: 'Delivery line',
  transfers: 'Transfer',
  transfer_lines: 'Transfer line',
  closing_stock: 'Closing stock',
  stock_counts: 'Stock count',
  stock_count_lines: 'Count line',
  wastage_batches: 'Wastage',
  wastage_lines: 'Wastage line',
  suppliers: 'Supplier',
  categories: 'Category',
  case_sizes: 'Case size',
  organisation_members: 'Membership',
  organisations: 'Organisation',
};

const SKIP_COLS = new Set(['updated_at', 'synced_at', 'source_updated_at', 'org_id', 'created_at']);

function fmt(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

/**
 * @param {{ table_name: string, op: string, old_data?: object|null, new_data?: object|null, changed_cols?: string[]|null }} row
 * @returns {{ record: string, summary: string }}
 */
export function describeAuditRow(row) {
  const label = AUDIT_TABLE_LABELS[row.table_name] || row.table_name;
  const data = row.new_data || row.old_data || {};
  const name = data.name || data.reference || data.label || '';
  const record = name ? `${label}: ${fmt(name)}` : label;

  if (row.op === 'EVENT') {
    return { record: label, summary: fmt(row.new_data) };
  }
  if (row.op === 'INSERT') return { record, summary: 'Created' };
  if (row.op === 'DELETE') return { record, summary: 'Deleted' };

  const cols = (row.changed_cols || []).filter((c) => !SKIP_COLS.has(c));
  if (!cols.length) return { record, summary: 'Updated' };
  const parts = cols.slice(0, 4).map((c) => `${c}: ${fmt(row.old_data?.[c])} → ${fmt(row.new_data?.[c])}`);
  if (cols.length > 4) parts.push(`+${cols.length - 4} more`);
  return { record, summary: parts.join('; ') };
}
