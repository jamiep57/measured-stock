// =====================================================================
// sync-engine.js
// =====================================================================
// Idempotent per-event rebuild of v2 relational rows from a V4
// stock_events jsonb blob. Pure server-side — uses sb (service role).
//
// Exports:
//   syncEvent(legacyId)       — rebuild all v2 rows for one event
//   syncRecipes()             — rebuild global recipes from __recipes__
//
// Algorithm:
//   1. Fetch blob from stock_events
//   2. Resolve event uuid (create on first sync, reuse via legacy_id_map)
//   3. Upsert global reference data (categories, suppliers, products)
//   4. Wipe per-event children (bars cascades to bar_products+distribution,
//      transfers cascades to lines, etc.)
//   5. Re-insert from blob (bars, recipients, event_products, distribution,
//      bar_products, counts, transfers, closing, topups, wastage, till,
//      modifier)
//   6. Stamp events.synced_at / source_updated_at
//
// Failure semantics: any throw is recorded on events.last_sync_error and
// re-thrown to the caller (the API handler returns 500).
// =====================================================================

import sb from './supabase-admin.js';

// ---------- Helpers --------------------------------------------------

function enc(v) { return encodeURIComponent(String(v)); }

/** "29/05/2026" → "2026-05-29" */
function parseUKDate(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Combine "29/05/2026" + "29 May 14:30" → ISO timestamp. Falls back to now. */
function parseUKDateTime(date, ts) {
  const d = parseUKDate(date);
  if (!d) return null;
  if (!ts) return `${d}T00:00:00Z`;
  const m = String(ts).match(/(\d{1,2}):(\d{2})/);
  if (!m) return `${d}T00:00:00Z`;
  return `${d}T${m[1].padStart(2, '0')}:${m[2]}:00Z`;
}

/**
 * Try to parse V4's free-text showDates into { start, end } ISO dates.
 * V4 doesn't constrain the format, so this is best-effort:
 *   "29 May 2026, 30 May, 1 Jun 2026"   → first + last with year
 *   "22,23,24,29,30,31"                 → null (no month/year) — let UI fill
 *   "29/05/2026 - 01/06/2026"           → parsed via UK date regex
 * When a token is unparseable or missing a year, we return null for that
 * end of the range rather than guessing — the events.start_date /
 * end_date columns are nullable and the merged app can let the user fix.
 */
function parseShowDates(s) {
  if (!s || typeof s !== 'string') return { start: null, end: null };
  const tokens = s.split(/[,\-–]/).map(x => x.trim()).filter(Boolean);
  if (!tokens.length) return { start: null, end: null };
  const months = {
    jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12
  };
  // Find a fallback year from ANY token (so "29 May, 1 Jun 2026" gives both).
  let fallbackYear = null;
  for (const t of tokens) {
    const ym = t.match(/\b(20\d{2})\b/);
    if (ym) { fallbackYear = parseInt(ym[1], 10); break; }
  }
  function p(text) {
    if (!text) return null;
    const iso = parseUKDate(text);
    if (iso) return iso;
    const m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    const yr  = m[3] ? parseInt(m[3], 10) : fallbackYear;
    if (!mon || !yr) return null;
    return `${yr}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return { start: p(tokens[0]), end: p(tokens[tokens.length - 1]) };
}

function nowIso() { return new Date().toISOString(); }

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Colour key map for v1 → v2 categories (matches catBadge in V4 app.js)
function colourKeyFor(name) {
  const k = String(name || '').toLowerCase();
  if (k.includes('beer'))                 return 'beer';
  if (k.includes('cider'))                return 'cider';
  if (k.includes('wine'))                 return 'wine';
  if (k.includes('spirit'))               return 'spirits';
  if (k.includes('rtd'))                  return 'rtd';
  if (k.includes('seltzer') || k.includes('soft')) return 'softs';
  if (k.includes('shot'))                 return 'spirits';
  if (k.includes('cocktail'))             return 'rtd';
  if (k.includes('water'))                return 'softs';
  return 'rtd';
}

// ---------- Reference data (global, upsert-only) --------------------

async function ensureCategories(names) {
  const cleaned = [...new Set(
    names.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim())
  )];
  if (!cleaned.length) return {};
  const rows = cleaned.map((name, i) => ({
    name,
    colour_key: colourKeyFor(name),
    sort_order: i,
  }));
  await sb.upsert('categories', rows, { onConflict: 'name' });
  // Refetch to pick up existing ids
  const all = await sb.get('categories', '?select=id,name');
  const map = {};
  for (const c of all) map[c.name] = c.id;
  return map;
}

async function ensureSuppliers(suppliersBlob, productsBlob) {
  // Collect names from both sources (suppliers list AND products[].supplier)
  const seen = new Map(); // name → default_sor_pct
  for (const s of (suppliersBlob || [])) {
    const name = String(s.name || '').trim();
    if (!name) continue;
    const sor = Math.max(0, Math.min(100, Number(s.sor || 0)));
    if (!seen.has(name)) seen.set(name, sor);
  }
  for (const p of (productsBlob || [])) {
    const name = String(p.supplier || '').trim();
    if (!name || seen.has(name)) continue;
    seen.set(name, 0);
  }
  if (!seen.size) return {};
  const rows = [...seen.entries()].map(([name, sor]) => ({
    name, default_sor_pct: sor,
  }));
  await sb.upsert('suppliers', rows, { onConflict: 'name' });
  const all = await sb.get('suppliers', '?select=id,name');
  const map = {};
  for (const s of all) map[s.name] = s.id;
  return map;
}

/**
 * For each product in the blob, find or create the global library row.
 * De-dup key: (name, supplier_id, case_size). Returns { legacyPid → uuid }.
 */
async function ensureProducts(productsBlob, catMap, supMap) {
  const result = {}; // legacyPid → uuid
  if (!productsBlob || !productsBlob.length) return result;

  // 1. Bulk lookup of legacy_id_map for these legacy pids
  const legacyIds = productsBlob.map(p => p.id).filter(Boolean);
  let known = [];
  if (legacyIds.length) {
    const qs = `?v2_table=eq.products&scope_id=eq.__global__&legacy_id=in.(${legacyIds.map(enc).join(',')})&select=legacy_id,new_id`;
    known = await sb.get('legacy_id_map', qs);
  }
  const knownMap = {};
  for (const k of known) knownMap[k.legacy_id] = k.new_id;

  // 2. For each product, resolve via map → natural key → insert
  for (const p of productsBlob) {
    if (!p || !p.id) continue;
    const legPid = p.id;
    if (knownMap[legPid]) {
      result[legPid] = knownMap[legPid];
      // Optional: update the row's mutable fields (case_price, etc.) — skip for now
      continue;
    }

    const name = String(p.name || '').trim();
    if (!name) continue;
    const supId = supMap[String(p.supplier || '').trim()] || null;
    const catId = catMap[String(p.category || '').trim()] || null;
    const caseSize = String(p.size || '').trim();

    // Natural key lookup
    let existing = [];
    if (supId) {
      const qs = `?name=eq.${enc(name)}&supplier_id=eq.${supId}&case_size=eq.${enc(caseSize)}&select=id`;
      existing = await sb.get('products', qs);
    } else {
      const qs = `?name=eq.${enc(name)}&supplier_id=is.null&case_size=eq.${enc(caseSize)}&select=id`;
      existing = await sb.get('products', qs);
    }

    let uuid;
    if (existing.length) {
      uuid = existing[0].id;
    } else {
      const [row] = await sb.insert('products', [{
        name,
        sku:            p.sku || null,
        case_size:      caseSize || null,
        units_per_case: numOrZero(p.unitsPerSku) || 1,
        case_price:     numOrNull(p.orderPrice),
        category_id:    catId,
        supplier_id:    supId,
      }]);
      uuid = row.id;
    }

    await sb.upsert('legacy_id_map', [{
      v2_table:  'products',
      legacy_id: legPid,
      scope_id:  '__global__',
      new_id:    uuid,
    }], { onConflict: 'v2_table,legacy_id,scope_id' });

    result[legPid] = uuid;
  }
  return result;
}

// ---------- Event uuid resolution -----------------------------------

async function ensureEventRow(legacy, blob) {
  // Look up existing uuid
  const map = await sb.get(
    'legacy_id_map',
    `?v2_table=eq.events&legacy_id=eq.${enc(legacy.id)}&scope_id=eq.__global__&select=new_id`
  );
  let eventUuid = map[0]?.new_id;

  // Parse dates from blob.showDates ("29 May, 30 May, 1 Jun 2026")
  const { start, end } = parseShowDates(blob.showDates);

  const payload = {
    name:        blob.showName || legacy.name || 'Untitled',
    start_date:  start,
    end_date:    end,
    venue:       null,
    status:      'active',
    event_type:  blob.type || null,
    legacy_id:   legacy.id,
  };

  if (eventUuid) {
    // linked_event_id handled in a second pass once all events are synced
    await sb.update('events', `id=eq.${eventUuid}`, payload);
  } else {
    const [row] = await sb.insert('events', [payload]);
    eventUuid = row.id;
    await sb.upsert('legacy_id_map', [{
      v2_table:  'events',
      legacy_id: legacy.id,
      scope_id:  '__global__',
      new_id:    eventUuid,
    }], { onConflict: 'v2_table,legacy_id,scope_id' });
  }

  // Try to resolve linked_event_id if the linked legacy id is already synced
  if (blob.linkedId) {
    const linkedMap = await sb.get(
      'legacy_id_map',
      `?v2_table=eq.events&legacy_id=eq.${enc(blob.linkedId)}&scope_id=eq.__global__&select=new_id`
    );
    const linkedUuid = linkedMap[0]?.new_id || null;
    if (linkedUuid) {
      await sb.update('events', `id=eq.${eventUuid}`, { linked_event_id: linkedUuid });
    }
    // else: orphan link, leave null. Will resolve on next sync if pair migrates.
  }

  return eventUuid;
}

// ---------- Per-event wipe ------------------------------------------

async function wipeEventChildren(eventUuid) {
  // Order matters where cascades aren't in place.
  // The DB has ON DELETE CASCADE on most child FKs, but we explicitly
  // delete in dependency order for safety and clarity.

  // Transfers (cascades to transfer_lines)
  await sb.delete('transfers', `or=(from_event_id.eq.${eventUuid},to_event_id.eq.${eventUuid})`);

  // Stock counts (cascades to lines)
  await sb.delete('stock_counts', `event_id=eq.${eventUuid}`);

  // Topup sessions (cascades to lines)
  await sb.delete('topup_sessions', `event_id=eq.${eventUuid}`);

  // Wastage batches (cascades to lines)
  await sb.delete('wastage_batches', `event_id=eq.${eventUuid}`);

  // Till + modifier imports (each cascades to its rows; unique constraint
  // would otherwise block re-insert anyway)
  await sb.delete('till_imports',     `event_id=eq.${eventUuid}`);
  await sb.delete('modifier_imports', `event_id=eq.${eventUuid}`);

  // Deliveries (cascades to lines)
  await sb.delete('deliveries', `event_id=eq.${eventUuid}`);

  // Closing + distribution + menu
  await sb.delete('closing_stock', `event_id=eq.${eventUuid}`);
  await sb.delete('distribution',  `event_id=eq.${eventUuid}`);
  await sb.delete('bar_products',  `event_id=eq.${eventUuid}`);

  // event_products (no children referencing it from above)
  await sb.delete('event_products', `event_id=eq.${eventUuid}`);

  // Recipients + bars last (transfers / distribution would block them otherwise)
  await sb.delete('recipients', `event_id=eq.${eventUuid}`);
  await sb.delete('bars',       `event_id=eq.${eventUuid}`);

  // Wipe per-event legacy_id_map entries (scope_id = legacy event id)
  // We DON'T delete the 'events' entry — that's how we kept the uuid stable.
  // Per-event scopes use the legacy event id as scope_id.
}

// ---------- Bars / recipients ---------------------------------------

async function insertBars(eventUuid, legacyEventId, blobBars) {
  if (!blobBars || !blobBars.length) return {};
  // De-dup by trimmed name (V4 doesn't enforce uniqueness)
  const seen = new Map();
  for (const raw of blobBars) {
    const name = String(raw || '').trim();
    if (!name || seen.has(name)) continue;
    seen.set(name, true);
  }
  const rows = [...seen.keys()].map(name => ({ event_id: eventUuid, name }));
  const inserted = await sb.insert('bars', rows);
  const map = {}; // bar_name → uuid
  for (const b of inserted) map[b.name] = b.id;

  // Save legacy map entries (scope = legacyEventId, legacy_id = bar name)
  await sb.upsert('legacy_id_map', inserted.map(b => ({
    v2_table: 'bars', legacy_id: b.name, scope_id: legacyEventId, new_id: b.id,
  })), { onConflict: 'v2_table,legacy_id,scope_id' });
  return map;
}

async function insertRecipients(eventUuid, legacyEventId, blobRecipients) {
  if (!blobRecipients || !blobRecipients.length) return {};
  const seen = new Map();
  for (const raw of blobRecipients) {
    const name = String(raw || '').trim();
    if (!name || seen.has(name)) continue;
    seen.set(name, true);
  }
  const rows = [...seen.keys()].map(name => ({ event_id: eventUuid, name }));
  const inserted = await sb.insert('recipients', rows);
  const map = {};
  for (const r of inserted) map[r.name] = r.id;
  await sb.upsert('legacy_id_map', inserted.map(r => ({
    v2_table: 'recipients', legacy_id: r.name, scope_id: legacyEventId, new_id: r.id,
  })), { onConflict: 'v2_table,legacy_id,scope_id' });
  return map;
}

// ---------- event_products (with opening merged) --------------------

/** Merge rows that share product_id (two legacy pids can map to one library row). */
function dedupeEventProductRows(rows) {
  const byProduct = new Map();
  for (const row of rows) {
    const existing = byProduct.get(row.product_id);
    if (!existing) {
      byProduct.set(row.product_id, { ...row });
      continue;
    }
    existing.qty_ordered += row.qty_ordered;
    existing.already_in_stock += row.already_in_stock;
    existing.damaged_qty += row.damaged_qty;
    if (row.invoice_qty != null) {
      existing.invoice_qty = (existing.invoice_qty ?? 0) + row.invoice_qty;
    }
    if (row.delivered_qty != null) {
      existing.delivered_qty = (existing.delivered_qty ?? 0) + row.delivered_qty;
    }
    if (!existing.arrival_day && row.arrival_day) existing.arrival_day = row.arrival_day;
  }
  return [...byProduct.values()];
}

async function insertEventProducts(eventUuid, blob, prodMap) {
  const products = blob.products || [];
  const opening  = blob.opening  || {};
  if (!products.length) return;
  const rows = [];
  for (const p of products) {
    const productId = prodMap[p.id];
    if (!productId) continue;
    const o = opening[p.id] || {};
    rows.push({
      event_id:             eventUuid,
      product_id:           productId,
      qty_ordered:          numOrZero(p.qtyOrdered),
      arrival_day:          p.arrival || null,
      already_in_stock:     numOrZero(o.alreadyInStock),
      invoice_qty:          numOrNull(o.invoiceQty),
      delivered_qty:        numOrNull(o.deliveredQty),
      damaged_qty:          numOrZero(o.damaged),
      order_price_override: null, // library default lives on products.case_price
      sor_pct_override:     null,
    });
  }
  const unique = dedupeEventProductRows(rows);
  if (unique.length) await sb.insert('event_products', unique);
}

// ---------- distribution + bar_products -----------------------------

async function insertDistribution(eventUuid, blob, prodMap, barMap) {
  const dist = blob.distribution || {};
  const menuRows = [];
  const distRows = [];
  const menuSeen = new Set(); // dedupe (bar_id, product_id)
  for (const [legPid, perBar] of Object.entries(dist)) {
    const productId = prodMap[legPid];
    if (!productId) continue;
    for (const [barName, qty] of Object.entries(perBar || {})) {
      const barId = barMap[barName];
      if (!barId) continue;
      const k = `${barId}|${productId}`;
      if (!menuSeen.has(k)) {
        menuRows.push({ event_id: eventUuid, bar_id: barId, product_id: productId });
        menuSeen.add(k);
      }
      const q = Number(qty);
      if (Number.isFinite(q) && q > 0) {
        distRows.push({ event_id: eventUuid, bar_id: barId, product_id: productId, qty_allocated: q });
      }
    }
  }
  if (menuRows.length) await sb.insert('bar_products', menuRows);
  if (distRows.length) await sb.insert('distribution', distRows);
}

// ---------- stock counts --------------------------------------------

async function insertCounts(eventUuid, blob, prodMap, barMap) {
  const counts = blob.counts || [];
  for (const session of counts) {
    const ctedAt = parseUKDateTime(session.date, null) ||
                   session.savedAt ||
                   nowIso();
    const sessionBarId = session.bar ? (barMap[session.bar] || null) : null;
    const [count] = await sb.insert('stock_counts', [{
      event_id:    eventUuid,
      bar_id:      sessionBarId,
      name:        session.name || 'Untitled count',
      counted_at:  ctedAt,
    }]);

    // V4 keys are "<productId>_<barName>". Parse with rsplit on last "_".
    // Some legacy keys may be just "<productId>" (single-bar count) or
    // nested objects (older v2-style). Handle all three.
    const data = session.data || {};
    const lines = [];
    for (const [rawKey, val] of Object.entries(data)) {
      if (val && typeof val === 'object' && (val.cases != null || val.singles != null)) {
        // V4 shape: "<pid>_<bar>" → { cases, singles }
        const lastUnderscore = rawKey.lastIndexOf('_');
        let pid = rawKey, barName = null;
        if (lastUnderscore > 0) {
          pid = rawKey.slice(0, lastUnderscore);
          barName = rawKey.slice(lastUnderscore + 1);
        }
        const productId = prodMap[pid];
        if (!productId) continue;
        const cases = numOrZero(val.cases);
        const singles = numOrZero(val.singles);
        if (cases === 0 && singles === 0) continue;
        lines.push({
          count_id:   count.id,
          product_id: productId,
          bar_id:     barName ? (barMap[barName] || null) : sessionBarId,
          cases,
          singles,
        });
      } else if (val && typeof val === 'object') {
        // Legacy v2 shape: pid → { barName → { cases, singles } }
        const productId = prodMap[rawKey];
        if (!productId) continue;
        for (const [barName, cell] of Object.entries(val)) {
          if (!cell) continue;
          const cases = numOrZero(cell.cases);
          const singles = numOrZero(cell.singles);
          if (cases === 0 && singles === 0) continue;
          lines.push({
            count_id:   count.id,
            product_id: productId,
            bar_id:     barMap[barName] || null,
            cases,
            singles,
          });
        }
      }
    }
    if (lines.length) await sb.insert('stock_count_lines', lines);
  }
}

// ---------- transfers (batched by V4 batchId) -----------------------

async function insertTransfers(eventUuid, blob, prodMap, recMap) {
  const transfers = blob.transfers || [];
  if (!transfers.length) return;

  // Group by batchId. Transfers without batchId become their own group.
  const groups = new Map(); // batchId → array of legacy lines
  for (const t of transfers) {
    const bid = t.batchId || t.id;
    if (!groups.has(bid)) groups.set(bid, []);
    groups.get(bid).push(t);
  }

  for (const [, lines] of groups) {
    const first = lines[0];
    // Resolve recipient (create on the fly if missing)
    const recName = String(first.recipientName || first.recipient || '').trim();
    let recipientId = recName ? recMap[recName] : null;
    if (recName && !recipientId) {
      const [r] = await sb.insert('recipients', [{ event_id: eventUuid, name: recName }]);
      recipientId = r.id;
      recMap[recName] = r.id;
    }

    const transferredAt = parseUKDateTime(first.date, first.timestamp) || nowIso();
    const unit = (first.unit === 'units') ? 'units' : 'cases';

    const [transferRow] = await sb.insert('transfers', [{
      transfer_type:   'event_to_recipient',
      from_event_id:   eventUuid,
      recipient_id:    recipientId,
      unit,
      transferred_at:  transferredAt,
    }]);

    const lineRows = [];
    for (const l of lines) {
      const productId = prodMap[l.productId];
      const qty = Number(l.qty);
      if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
      lineRows.push({
        transfer_id:        transferRow.id,
        product_id:         productId,
        qty,
        unit_cost:          null,
        chargeback_applied: false,
      });
    }
    if (lineRows.length) await sb.insert('transfer_lines', lineRows);
  }
}

// ---------- closing -------------------------------------------------

async function insertClosing(eventUuid, blob, prodMap) {
  const closing = blob.closing || {};
  if (!Object.keys(closing).length) return;

  // We need units_per_case to compute close_count for cases/singles shape.
  // Look up via the global products table for the affected ids.
  const wantedIds = [...new Set(
    Object.keys(closing).map(pid => prodMap[pid]).filter(Boolean)
  )];
  let upcByProduct = {};
  if (wantedIds.length) {
    const qs = `?id=in.(${wantedIds.join(',')})&select=id,units_per_case`;
    const rows = await sb.get('products', qs);
    for (const r of rows) upcByProduct[r.id] = Number(r.units_per_case) || 1;
  }

  const rows = [];
  for (const [legPid, c] of Object.entries(closing)) {
    const productId = prodMap[legPid];
    if (!productId) continue;
    const cases = numOrZero(c.closingCases);
    const singles = numOrZero(c.closingSingles);
    let closeCount;
    if (c.closingCases != null || c.closingSingles != null) {
      const upc = upcByProduct[productId] || 1;
      closeCount = cases * upc + singles;
    } else if (c.fullCount != null) {
      closeCount = numOrZero(c.fullCount);
    } else {
      closeCount = 0;
    }
    rows.push({
      event_id:         eventUuid,
      product_id:       productId,
      close_count:      Math.max(0, closeCount),
      return_amount:    Math.max(0, numOrZero(c.returnAmount)),
      closing_cases:    cases,
      closing_singles:  singles,
      carried_over:     Math.max(0, numOrZero(c.carriedOver)),
    });
  }
  if (rows.length) await sb.insert('closing_stock', rows);
}

// ---------- topups (V4 mini-delivery shape) -------------------------

async function insertTopups(eventUuid, blob, prodMap, supMap) {
  const topups = blob.topups || [];
  for (const session of topups) {
    const supplierId = supMap[String(session.supplier || '').trim()] || null;
    const recordedAt = parseUKDateTime(session.date, null) || nowIso();
    const [s] = await sb.insert('topup_sessions', [{
      event_id:     eventUuid,
      name:         session.name || 'Untitled top-up',
      supplier_id:  supplierId,
      recorded_at:  recordedAt,
    }]);

    const entries = session.entries || {};
    const lines = [];
    for (const [legPid, e] of Object.entries(entries)) {
      const productId = prodMap[legPid];
      if (!productId) continue;
      const qty = numOrZero(e.qty);
      if (qty < 0) continue;
      lines.push({
        session_id:     s.id,
        product_id:     productId,
        qty,
        damaged_qty:    numOrZero(e.damaged),
        invoice_price:  numOrNull(e.invoicePrice),
        supplier_id:    supMap[String(e.supplier || '').trim()] || supplierId,
      });
    }
    if (lines.length) await sb.insert('topup_lines', lines);
  }
}

// ---------- wastage (V4 grouped by batchId) -------------------------

async function insertWastage(eventUuid, blob, prodMap) {
  const wastage = blob.wastage || [];
  if (!wastage.length) return;

  const groups = new Map();
  for (const w of wastage) {
    const bid = w.batchId || w.id;
    if (!groups.has(bid)) groups.set(bid, []);
    groups.get(bid).push(w);
  }

  for (const [, items] of groups) {
    const first = items[0];
    const recordedAt = parseUKDateTime(first.date, first.timestamp) || nowIso();
    const [b] = await sb.insert('wastage_batches', [{
      event_id:    eventUuid,
      unit:        first.unit === 'units' ? 'units' : 'cases',
      reason:      first.reason || null,
      recorded_at: recordedAt,
    }]);

    const lines = [];
    for (const w of items) {
      const productId = prodMap[w.productId];
      const qty = numOrZero(w.qty);
      if (!productId || qty <= 0) continue;
      lines.push({
        batch_id:   b.id,
        product_id: productId,
        qty,
      });
    }
    if (lines.length) await sb.insert('wastage_lines', lines);
  }
}

// ---------- till sales ---------------------------------------------

async function insertTillSales(eventUuid, blob) {
  const till = blob.tillSales;
  if (!till || !till.rows || !till.rows.length) return;
  const [imp] = await sb.insert('till_imports', [{
    event_id:    eventUuid,
    imported_at: till.importedAt || nowIso(),
    file_name:   till.fileName || null,
  }]);
  const rows = till.rows.map(r => ({
    import_id:    imp.id,
    name:         r.name || '',
    variation:    r.variation || null,
    sku:          r.sku || null,
    category:     r.category || null,
    items_sold:   numOrZero(r.itemsSold),
    net_sales:    numOrZero(r.netSales),
    gross_sales:  numOrZero(r.grossSales),
  }));
  if (rows.length) await sb.insert('till_sale_rows', rows);
}

// ---------- modifier sales -----------------------------------------

async function insertModifierSales(eventUuid, blob) {
  const mod = blob.modifierSales;
  if (!mod || !mod.rows || !mod.rows.length) return;
  const [imp] = await sb.insert('modifier_imports', [{
    event_id:    eventUuid,
    imported_at: mod.importedAt || nowIso(),
    file_name:   mod.fileName || null,
  }]);
  const rows = mod.rows.map(r => ({
    import_id:     imp.id,
    modifier_set:  r.modifierSet || r.set || null,
    modifier:      r.modifier || r.name || '',
    qty_sold:      numOrZero(r.qtySold ?? r.itemsSold),
    net_sales:     numOrZero(r.netSales),
  }));
  if (rows.length) await sb.insert('modifier_sale_rows', rows);
}

// =====================================================================
// Public: syncEvent
// =====================================================================

export async function syncEvent(legacyId) {
  if (!legacyId) throw new Error('syncEvent: legacyId required');

  // 1. Fetch blob
  const found = await sb.get(
    'stock_events',
    `?id=eq.${enc(legacyId)}&select=id,name,data,updated_at`
  );
  if (!found.length) throw new Error(`syncEvent: stock_events row ${legacyId} not found`);
  const legacy = found[0];
  const blob = legacy.data || {};
  if (!blob.id) blob.id = legacy.id;
  const blobUpdatedAt = legacy.updated_at;

  // 2. Resolve/create event uuid (and update top-level fields)
  const eventUuid = await ensureEventRow(legacy, blob);

  // 3. Global reference data
  const catMap = await ensureCategories(blob.categories || []);
  const supMap = await ensureSuppliers(blob.suppliers || [], blob.products || []);
  const prodMap = await ensureProducts(blob.products || [], catMap, supMap);

  // 4. Wipe per-event children (keeps events row + global library)
  try {
    await wipeEventChildren(eventUuid);
  } catch (err) {
    await markSyncError(eventUuid, blobUpdatedAt, err);
    throw err;
  }

  // 5. Re-insert from blob
  try {
    const barMap = await insertBars(eventUuid, legacy.id, blob.bars);
    const recMap = await insertRecipients(eventUuid, legacy.id, blob.recipients);
    await insertEventProducts(eventUuid, blob, prodMap);
    await insertDistribution(eventUuid, blob, prodMap, barMap);
    await insertCounts(eventUuid, blob, prodMap, barMap);
    await insertTransfers(eventUuid, blob, prodMap, recMap);
    await insertClosing(eventUuid, blob, prodMap);
    await insertTopups(eventUuid, blob, prodMap, supMap);
    await insertWastage(eventUuid, blob, prodMap);
    await insertTillSales(eventUuid, blob);
    await insertModifierSales(eventUuid, blob);
  } catch (err) {
    await markSyncError(eventUuid, blobUpdatedAt, err);
    throw err;
  }

  // 6. Stamp synced_at / source_updated_at
  await sb.update('events', `id=eq.${eventUuid}`, {
    synced_at:           nowIso(),
    source_updated_at:   blobUpdatedAt,
    last_sync_error:     null,
    last_sync_error_at:  null,
  });

  return {
    ok: true,
    legacyId: legacy.id,
    eventId:  eventUuid,
    blob_updated_at: blobUpdatedAt,
  };
}

async function markSyncError(eventUuid, blobUpdatedAt, err) {
  try {
    await sb.update('events', `id=eq.${eventUuid}`, {
      last_sync_error:    String(err?.message || err).slice(0, 1000),
      last_sync_error_at: nowIso(),
      source_updated_at:  blobUpdatedAt,
    });
  } catch (_) { /* swallow — don't mask original error */ }
}

// =====================================================================
// Public: syncRecipes
// =====================================================================

export async function syncRecipes() {
  const found = await sb.get(
    'stock_events',
    `?id=eq.__recipes__&select=id,data,updated_at`
  );
  if (!found.length) {
    // Nothing to sync — clear v2 recipes? Only if explicitly desired.
    return { ok: true, recipeCount: 0, note: 'no __recipes__ row found' };
  }
  const blob = found[0].data || {};
  const recipes = Array.isArray(blob.recipes) ? blob.recipes : [];

  // Replace strategy: delete all + re-insert. Simpler than upsert chains
  // and matches the "blob is source of truth" model.
  await sb.delete('recipes', 'id=not.is.null');

  for (const r of recipes) {
    const tillItem = String(r.tillItem || '').trim();
    if (!tillItem) continue;
    const [rec] = await sb.insert('recipes', [{
      till_item:      tillItem,
      till_variation: String(r.tillVariation || '').trim(),
      unit_model:     r._unitModel || null,
      notes:          r.notes || null,
    }]);
    const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
    const lines = [];
    for (let i = 0; i < ings.length; i++) {
      const ing = ings[i] || {};
      const productName = String(ing.productName || '').trim();
      const qty = Number(ing.qty);
      if (!productName || !Number.isFinite(qty) || qty <= 0) continue;
      lines.push({
        recipe_id:    rec.id,
        product_name: productName,
        qty,
        position:     i,
      });
    }
    if (lines.length) await sb.insert('recipe_ingredients', lines);
  }

  // Track sync state
  await sb.upsert('system_sync_state', [{
    key:                '__recipes__',
    synced_at:          nowIso(),
    source_updated_at:  found[0].updated_at,
    last_error:         null,
    last_error_at:      null,
  }], { onConflict: 'key' });

  return { ok: true, recipeCount: recipes.length };
}

export default { syncEvent, syncRecipes };
