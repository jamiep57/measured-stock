/**
 * Kit label print queue — mobile enqueues; desktop prints to QL-800.
 */

/**
 * @param {number} [raw]
 * @returns {number}
 */
export function normalizeLabelCopies(raw) {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 50);
}

/**
 * Load pending queue rows with product details.
 * @param {{ select: Function }} DB
 */
export async function loadPendingKitLabelQueue(DB) {
  try {
    const rows = await DB.select(
      'kit_label_queue',
      '?printed_at=is.null'
        + '&select=id,product_id,copies,note,created_at,'
        + 'product:products(id,name,sku,barcode,is_container,category_id,'
        + 'category:categories(id,name))'
        + '&order=created_at',
    );
    return rows || [];
  } catch (err) {
    const msg = String(err?.message || err);
    if (/kit_label_queue|does not exist|PGRST|relation/.test(msg)) return [];
    throw err;
  }
}

/**
 * Count pending labels (sum of copies).
 * @param {Array<{ copies?: number }>} rows
 */
export function pendingLabelQueueStats(rows) {
  const list = rows || [];
  let copies = 0;
  for (const row of list) copies += normalizeLabelCopies(row.copies);
  return { items: list.length, copies };
}

/**
 * Enqueue a product for label printing. If already pending, bump copies.
 * Ensures a printable barcode is persisted when missing.
 *
 * @param {object} DB
 * @param {{ id: string, name?: string, barcode?: string|null, sku?: string|null, is_container?: boolean }} product
 * @param {{ copies?: number, note?: string|null, resolveBarcode?: (p: object) => { barcode: string, shouldPersist: boolean } }} [opts]
 */
export async function enqueueKitLabel(DB, product, opts = {}) {
  if (!product?.id) throw new Error('Save the item before queueing a label.');
  const copies = normalizeLabelCopies(opts.copies);
  const note = (opts.note == null ? '' : String(opts.note)).trim() || null;

  let barcode = String(product.barcode ?? '').trim() || null;
  if (opts.resolveBarcode) {
    const resolved = opts.resolveBarcode(product);
    barcode = resolved.barcode;
    if (resolved.shouldPersist) {
      await DB.products.update(product.id, { barcode });
      product.barcode = barcode;
    }
  }

  const pending = await DB.select(
    'kit_label_queue',
    `?product_id=eq.${DB._.enc(product.id)}&printed_at=is.null&select=id,copies&limit=1`,
  ).catch(() => []);

  const existing = pending?.[0] || null;
  if (existing?.id) {
    const nextCopies = normalizeLabelCopies((Number(existing.copies) || 0) + copies);
    const patch = { copies: nextCopies };
    if (note) patch.note = note;
    const updated = await DB.update(
      'kit_label_queue',
      `id=eq.${DB._.enc(existing.id)}`,
      patch,
    );
    return { row: updated?.[0] || { ...existing, copies: nextCopies }, created: false, barcode };
  }

  const inserted = await DB.insert('kit_label_queue', {
    product_id: product.id,
    copies,
    note,
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return { row, created: true, barcode };
}

/**
 * Mark queue rows as printed.
 * @param {object} DB
 * @param {string[]} ids
 */
export async function markKitLabelsPrinted(DB, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return [];
  const enc = DB._.enc;
  return DB.update(
    'kit_label_queue',
    `id=in.(${list.map(enc).join(',')})`,
    { printed_at: new Date().toISOString() },
  );
}

/**
 * Remove a pending queue row (or any row by id).
 * @param {object} DB
 * @param {string} id
 */
export async function removeKitLabelQueueItem(DB, id) {
  if (!id) return;
  return DB.remove('kit_label_queue', `id=eq.${DB._.enc(id)}`);
}

/**
 * Set copies on a pending row.
 * @param {object} DB
 * @param {string} id
 * @param {number} copies
 */
export async function setKitLabelQueueCopies(DB, id, copies) {
  if (!id) return null;
  const n = normalizeLabelCopies(copies);
  const rows = await DB.update(
    'kit_label_queue',
    `id=eq.${DB._.enc(id)}`,
    { copies: n },
  );
  return rows?.[0] || null;
}
