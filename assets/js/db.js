// =====================================================================
// db.js — V2 relational data layer (browser)
// =====================================================================
// A thin client over the v2 relational tables (PostgREST / Supabase),
// for the merged-app rewrite (Phase 4). The legacy app.js still reads
// and writes the stock_events blob; this module is the parallel path
// that talks to the normalised tables (products, events,
// event_products, …) the sync engine has been populating.
//
// Design goals:
//   - Same transport style as app.js: raw PostgREST fetch with the anon
//     key. RLS (migration 004) grants anon full CRUD on every v2 table,
//     so no service-role key is needed in the browser.
//   - No build step / no ES modules — attaches a single global `window.DB`
//     to match how app.js is loaded.
//   - A small core (select/insert/upsert/update/remove/rpc) plus one
//     repository object per table, with a few composite reads
//     (e.g. DB.events.getFull) for the panels.
//
// Usage:
//   DB.configure({ url, key });          // optional; auto-inits otherwise
//   const products = await DB.products.list();
//   const ev = await DB.events.getFull(eventId);
//
// IMPORTANT: this layer is additive. It does not change blob behaviour.
// Panels are migrated to it one at a time; until a panel is cut over,
// the blob remains the source of truth and the sync engine keeps these
// tables current.
// =====================================================================

(function (global) {
  'use strict';

  // ---------- Config -------------------------------------------------
  // Fallback matches app.js BUILTIN_CLOUD_CONFIG (anon key, safe for the
  // browser). DB.configure() or window.__CLOUD_CONFIG__ override it.
  const BUILTIN = {
    url: 'https://qqdvzcaukstfdixnfuqq.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
  };

  let cfg = { url: '', key: '' };

  function init() {
    // Precedence: explicit global → app.js localStorage → builtin.
    if (global.__CLOUD_CONFIG__ && global.__CLOUD_CONFIG__.url) {
      cfg = {
        url: String(global.__CLOUD_CONFIG__.url).replace(/\/$/, ''),
        key: global.__CLOUD_CONFIG__.key || '',
      };
      return;
    }
    try {
      const raw = global.localStorage && localStorage.getItem('measured_stock_cloud');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.url && parsed.key) {
          cfg = { url: String(parsed.url).replace(/\/$/, ''), key: parsed.key };
          return;
        }
      }
    } catch (_) { /* ignore */ }
    cfg = { url: BUILTIN.url.replace(/\/$/, ''), key: BUILTIN.key };
  }

  function configure(next) {
    if (!next || !next.url || !next.key) {
      throw new Error('DB.configure: { url, key } required');
    }
    cfg = { url: String(next.url).replace(/\/$/, ''), key: next.key };
  }

  function isConfigured() { return !!(cfg.url && cfg.key); }

  // ---------- Core transport ----------------------------------------

  function headers(extra) {
    return Object.assign({
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json',
    }, extra || {});
  }

  async function request(method, path, opts) {
    if (!isConfigured()) init();
    if (!isConfigured()) throw new Error('DB: not configured (missing url/key)');
    opts = opts || {};
    const res = await fetch(cfg.url + '/rest/v1' + path, {
      method,
      headers: headers(opts.headers),
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      throw new Error('DB ' + method + ' ' + path + ' → ' + res.status + ': ' + body);
    }
    // DELETE / minimal responses may have empty bodies.
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  }

  /**
   * SELECT. `query` is a PostgREST query string starting after the table
   * name, e.g. "?select=*&order=name" or "?id=eq.<uuid>".
   */
  function select(table, query) {
    return request('GET', '/' + table + (query || ''));
  }

  /** INSERT rows (array). Returns inserted rows unless returning:false. */
  function insert(table, rows, opts) {
    opts = opts || {};
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return Promise.resolve([]);
    const prefer = opts.returning === false
      ? 'return=minimal'
      : 'return=representation';
    return request('POST', '/' + table, { headers: { Prefer: prefer }, body: list });
  }

  /**
   * UPSERT rows by PK or a unique constraint (pass onConflict columns).
   * Returns the resulting rows.
   */
  function upsert(table, rows, opts) {
    opts = opts || {};
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return Promise.resolve([]);
    const q = opts.onConflict
      ? '?on_conflict=' + encodeURIComponent(opts.onConflict)
      : '';
    const prefer = 'resolution=merge-duplicates,' +
      (opts.returning === false ? 'return=minimal' : 'return=representation');
    return request('POST', '/' + table + q, { headers: { Prefer: prefer }, body: list });
  }

  /** PATCH rows matching a filter (PostgREST filter, no leading "?"). */
  function update(table, filter, patch) {
    return request('PATCH', '/' + table + '?' + filter, {
      headers: { Prefer: 'return=representation' },
      body: patch,
    });
  }

  /** DELETE rows matching a filter (PostgREST filter, no leading "?"). */
  function remove(table, filter) {
    return request('DELETE', '/' + table + '?' + filter);
  }

  /** Call a Postgres function (RPC). */
  function rpc(fn, args) {
    return request('POST', '/rpc/' + fn, { body: args || {} });
  }

  // ---------- Storage (Supabase Storage REST) -----------------------

  /**
   * Upload a File/Blob to a public storage bucket and return its public URL.
   * Requires the bucket to exist and be public. `path` is the object key.
   */
  async function uploadImage(bucket, path, file) {
    if (!isConfigured()) init();
    const url = cfg.url + '/storage/v1/object/' + bucket + '/' + encodeURI(path);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
        'Cache-Control': '3600',
      },
      body: file,
    });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      throw new Error('Upload failed (' + res.status + '): ' + body);
    }
    return cfg.url + '/storage/v1/object/public/' + bucket + '/' + encodeURI(path);
  }

  // ---------- Helpers ------------------------------------------------

  const enc = (v) => encodeURIComponent(String(v));
  const eqId = (id) => 'id=eq.' + enc(id);

  function numOrNull(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function numOrZero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /** Generic repository factory for simple tables. */
  function makeRepo(table, opts) {
    opts = opts || {};
    const defaultSelect = opts.select || '*';
    const defaultOrder = opts.order ? '&order=' + opts.order : '';
    return {
      table,
      list(query) {
        if (query) return select(table, query);
        return select(table, '?select=' + defaultSelect + defaultOrder);
      },
      get(id, sel) {
        return select(table, '?' + eqId(id) + '&select=' + (sel || defaultSelect))
          .then((rows) => (rows && rows[0]) || null);
      },
      where(filter, sel) {
        return select(table, '?' + filter + '&select=' + (sel || defaultSelect));
      },
      create(row) { return insert(table, row).then((r) => r[0]); },
      createMany(rows) { return insert(table, rows); },
      upsert(rows, conflict) {
        return upsert(table, rows, { onConflict: conflict || 'id' });
      },
      update(id, patch) {
        return update(table, eqId(id), patch).then((r) => (r && r[0]) || null);
      },
      remove(id) { return remove(table, eqId(id)); },
      removeWhere(filter) { return remove(table, filter); },
    };
  }

  // ---------- Reference repos (global) -------------------------------

  const categories = Object.assign(
    makeRepo('categories', { order: 'sort_order,name' }),
    {
      // Fold one or more duplicate categories into a single keeper. Every
      // product on a duplicate is re-pointed to the keeper, then the
      // duplicate category rows are deleted. Atomic — runs in the
      // merge_categories() RPC (migration 017). Returns { kept, merged }.
      merge(keepId, dupIds) {
        return rpc('merge_categories', {
          p_keep: keepId,
          p_dups: Array.isArray(dupIds) ? dupIds : [dupIds],
        });
      },
    }
  );
  const suppliers = makeRepo('suppliers', { order: 'name' });
  const warehouses = makeRepo('warehouses', { order: 'name' });
  const caseSizes = makeRepo('case_sizes', { order: 'sort_order,label' });

  // Migration 020 adds pack_size + units_per_case on product_suppliers.
  // Probe once so older databases keep working until that SQL is applied.
  let _productOffersReady = null;

  async function probeProductOffers() {
    if (_productOffersReady != null) return _productOffersReady;
    try {
      await select('product_suppliers', '?select=pack_size&limit=1');
      _productOffersReady = true;
    } catch (err) {
      const msg = String(err && err.message || err);
      if (msg.includes('pack_size') && msg.includes('does not exist')) {
        _productOffersReady = false;
      } else {
        throw err;
      }
    }
    return _productOffersReady;
  }

  function enrichLegacyProductOffers(products) {
    (products || []).forEach((p) => {
      (p.product_suppliers || []).forEach((ps) => {
        if (!ps.pack_size) ps.pack_size = p.case_size || '';
        if (ps.units_per_case == null) ps.units_per_case = p.units_per_case;
      });
    });
    return products;
  }

  const products = Object.assign(
    makeRepo('products', { order: 'name' }),
    {
      // Library view with supplier + category names resolved, plus the
      // full set of supplier/price rows (product_suppliers) for each
      // product. The legacy supplier/case_price/unit_price columns still
      // mirror the preferred row (kept in sync by migration 016 triggers).
      async listFull() {
        const offers = await probeProductOffers();
        const psCols = offers
          ? 'id,supplier_id,sku,pack_size,units_per_case,case_price,unit_price,is_preferred,supplier:suppliers(id,name)'
          : 'id,supplier_id,sku,case_price,unit_price,is_preferred,supplier:suppliers(id,name)';
        const rows = await select(
          'products',
          '?select=*,supplier:suppliers(id,name),category:categories(id,name,colour_key)' +
          ',product_suppliers(' + psCols + ')' +
          '&order=name'
        );
        return offers ? rows : enrichLegacyProductOffers(rows);
      },
      bySupplier(supplierId) {
        return select('products', '?supplier_id=eq.' + enc(supplierId) + '&select=*&order=name');
      },
      // Fold one or more duplicate products into a single keeper. Re-points
      // every child table (event_products, distribution, deliveries, …),
      // summing quantities on unique-constraint collisions, folds every
      // supplier purchase option together (migration 020) and then deletes
      // the duplicate product rows. Optional `fields` carries per-field
      // choices from the merge dialog. Atomic — merge_products() RPC.
      // Returns { kept, merged }.
      // `fields` optional — { name, category_id, case_size, units_per_case, sku, abv }
      // from the merge dialog's per-field source picks.
      async merge(keepId, dupIds, fields) {
        const dups = Array.isArray(dupIds) ? dupIds : [dupIds];
        const base = { p_keep: keepId, p_dups: dups };
        const offers = await probeProductOffers();
        if (offers && fields && Object.keys(fields).length) {
          return rpc('merge_products', Object.assign({}, base, { p_fields: fields }));
        }
        return rpc('merge_products', base);
      },
      normalise(input) {
        // Map a UI product object to the products table shape.
        return {
          name: input.name,
          supplier_id: input.supplier_id || null,
          category_id: input.category_id || null,
          abv: numOrNull(input.abv),
          sku: input.sku || null,
          case_size: input.case_size || null,
          case_size_id: input.case_size_id || null,
          units_per_case: numOrZero(input.units_per_case) || 1,
          stock_unit: input.stock_unit || null,
          unit_price: numOrNull(input.unit_price),
          case_price: numOrNull(input.case_price),
        };
      },
      // Remove a product from the library together with every row that
      // references it (events, deliveries, closing stock, etc.).
      async deleteFull(productId) {
        const id = enc(productId);
        try {
          return await rpc('delete_product', { p_id: productId });
        } catch (e) {
          const msg = e && e.message ? String(e.message) : '';
          const rpcMissing = /delete_product|PGRST202|42883|does not exist/i.test(msg);
          if (!rpcMissing) throw e;
        }
        const childTables = [
          'stock_count_lines', 'wastage_lines', 'transfer_lines', 'delivery_lines',
          'topup_lines', 'bar_products', 'distribution', 'closing_stock',
          'event_products', 'warehouse_stock', 'product_suppliers',
        ];
        for (const table of childTables) {
          await remove(table, 'product_id=eq.' + id);
        }
        return remove('products', eqId(productId));
      },
    }
  );

  const productSuppliers = Object.assign(
    makeRepo('product_suppliers'),
    {
      forProduct(productId) {
        return select(
          'product_suppliers',
          '?product_id=eq.' + enc(productId) +
          '&select=*,supplier:suppliers(id,name)' +
          '&order=is_preferred.desc,created_at.asc'
        );
      },
      // Replace the entire supplier/price set for a product in one shot.
      // Simpler than diffing for a single-user library editor; the
      // migration-016 triggers re-sync the legacy product columns after.
      // `rows` items: { supplier_id, pack_size?, units_per_case?, sku?,
      //   case_price?, unit_price?, is_preferred? }
      async replaceForProduct(productId, rows) {
        await remove('product_suppliers', 'product_id=eq.' + enc(productId));
        const clean = (rows || []).filter((r) => r && r.supplier_id);
        if (!clean.length) return [];
        const offers = await probeProductOffers();
        return insert('product_suppliers', clean.map((r) => {
          const row = {
            product_id: productId,
            supplier_id: r.supplier_id,
            sku: (r.sku != null ? String(r.sku) : '').trim(),
            case_price: numOrNull(r.case_price),
            unit_price: numOrNull(r.unit_price),
            is_preferred: !!r.is_preferred,
          };
          if (offers) {
            row.pack_size = (r.pack_size != null ? String(r.pack_size) : '').trim();
            row.units_per_case = numOrNull(r.units_per_case);
          }
          return row;
        }));
      },
    }
  );

  const warehouseStock = Object.assign(
    makeRepo('warehouse_stock'),
    {
      forWarehouse(warehouseId) {
        return select(
          'warehouse_stock',
          '?warehouse_id=eq.' + enc(warehouseId) +
          '&select=*,product:products(id,name,case_size)'
        );
      },
      setQty(warehouseId, productId, qty) {
        return upsert('warehouse_stock', [{
          warehouse_id: warehouseId,
          product_id: productId,
          qty_on_hand: numOrZero(qty),
          last_updated: new Date().toISOString(),
        }], { onConflict: 'warehouse_id,product_id' }).then((r) => r[0]);
      },
    }
  );

  // ---------- Event + per-event repos -------------------------------

  const eventProducts = Object.assign(
    makeRepo('event_products'),
    {
      forEvent(eventId) {
        return select(
          'event_products',
          '?event_id=eq.' + enc(eventId) +
          '&select=*,product:products(id,name,case_size,units_per_case,case_price,abv,category_id,supplier_id)' +
          '&order=id'
        );
      },
      setForEvent(eventId, productId, patch) {
        // Upsert one line (unique on event_id, product_id).
        const row = Object.assign({ event_id: eventId, product_id: productId }, patch);
        return upsert('event_products', [row], { onConflict: 'event_id,product_id' })
          .then((r) => r[0]);
      },
      removeForEvent(eventId, productId) {
        return remove(
          'event_products',
          'event_id=eq.' + enc(eventId) + '&product_id=eq.' + enc(productId)
        );
      },
      // Detach a product from one event only — keeps the library product and
      // any delivery / transfer history on this event.
      async removeFromEvent(eventId, productId) {
        const eid = enc(eventId);
        const pid = enc(productId);
        const scoped = 'event_id=eq.' + eid + '&product_id=eq.' + pid;
        await Promise.all([
          remove('closing_stock', scoped),
          remove('distribution', scoped),
          remove('bar_products', scoped),
          remove('event_products', scoped),
        ]);
      },
    }
  );

  const bars = Object.assign(
    makeRepo('bars'),
    { forEvent(eventId) { return select('bars', '?event_id=eq.' + enc(eventId) + '&select=*&order=name'); } }
  );

  const recipients = Object.assign(
    makeRepo('recipients', { order: 'name' }),
    { forEvent(eventId) { return select('recipients', '?event_id=eq.' + enc(eventId) + '&select=*&order=name'); } }
  );

  const distribution = Object.assign(
    makeRepo('distribution'),
    {
      forEvent(eventId) {
        return select(
          'distribution',
          '?event_id=eq.' + enc(eventId) +
          '&select=*,bar:bars(id,name),product:products(id,name)'
        );
      },
      setAllocation(eventId, barId, productId, qty) {
        return upsert('distribution', [{
          event_id: eventId, bar_id: barId, product_id: productId,
          qty_allocated: numOrZero(qty),
        }], { onConflict: 'event_id,bar_id,product_id' }).then((r) => r[0]);
      },
    }
  );

  const barProducts = Object.assign(
    makeRepo('bar_products'),
    { forEvent(eventId) { return select('bar_products', '?event_id=eq.' + enc(eventId) + '&select=*'); } }
  );

  const stockCounts = Object.assign(
    makeRepo('stock_counts', { order: 'counted_at' }),
    {
      forEvent(eventId) { return select('stock_counts', '?event_id=eq.' + enc(eventId) + '&select=*&order=counted_at'); },
      lines(countId) { return select('stock_count_lines', '?count_id=eq.' + enc(countId) + '&select=*'); },
      addLines(rows) { return insert('stock_count_lines', rows); },
      clearLines(countId) { return remove('stock_count_lines', 'count_id=eq.' + enc(countId)); },
    }
  );

  const closing = Object.assign(
    makeRepo('closing_stock'),
    {
      forEvent(eventId) {
        return select(
          'closing_stock',
          '?event_id=eq.' + enc(eventId) + '&select=*,product:products(id,name)'
        );
      },
      setForEvent(eventId, productId, patch) {
        const row = Object.assign({ event_id: eventId, product_id: productId }, patch);
        return upsert('closing_stock', [row], { onConflict: 'event_id,product_id' })
          .then((r) => r[0]);
      },
    }
  );

  const supplierReturns = Object.assign(
    makeRepo('supplier_return_lines'),
    {
      forEvent(eventId) {
        return select(
          'supplier_return_lines',
          '?event_id=eq.' + enc(eventId) + '&select=*&order=created_at'
        );
      },
      replaceForProduct(eventId, productId, rows) {
        const filter = 'event_id=eq.' + enc(eventId) + '&product_id=eq.' + enc(productId);
        return remove('supplier_return_lines', filter).then(() =>
          (rows && rows.length) ? insert('supplier_return_lines', rows) : []
        );
      },
    }
  );

  const transfers = Object.assign(
    makeRepo('transfers', { order: 'transferred_at' }),
    {
      forEvent(eventId) {
        return select(
          'transfers',
          '?or=(from_event_id.eq.' + enc(eventId) + ',to_event_id.eq.' + enc(eventId) + ')' +
          '&select=*,recipients(id,name),lines:transfer_lines(*,product:products(id,name))&order=transferred_at.desc'
        );
      },
      lines(transferId) {
        return select(
          'transfer_lines',
          '?transfer_id=eq.' + enc(transferId) + '&select=*,product:products(id,name)'
        );
      },
      addLines(rows) { return insert('transfer_lines', rows); },
      clearLines(transferId) { return remove('transfer_lines', 'transfer_id=eq.' + enc(transferId)); },
    }
  );

  const deliveries = Object.assign(
    makeRepo('deliveries', { order: 'delivered_at' }),
    {
      forEvent(eventId) {
        return select(
          'deliveries',
          '?event_id=eq.' + enc(eventId) +
          '&select=*,lines:delivery_lines(*),supplier:suppliers(id,name)&order=delivered_at'
        );
      },
      addLines(rows) { return insert('delivery_lines', rows); },
      clearLines(deliveryId) { return remove('delivery_lines', 'delivery_id=eq.' + enc(deliveryId)); },
    }
  );

  const topups = Object.assign(
    makeRepo('topup_sessions', { order: 'recorded_at' }),
    {
      forEvent(eventId) {
        return select(
          'topup_sessions',
          '?event_id=eq.' + enc(eventId) +
          '&select=*,lines:topup_lines(*),supplier:suppliers(id,name)&order=recorded_at'
        );
      },
      addLines(rows) { return insert('topup_lines', rows); },
    }
  );

  const wastage = Object.assign(
    makeRepo('wastage_batches', { order: 'recorded_at' }),
    {
      forEvent(eventId) {
        return select(
          'wastage_batches',
          '?event_id=eq.' + enc(eventId) +
          '&select=*,lines:wastage_lines(*)&order=recorded_at'
        );
      },
      addLines(rows) { return insert('wastage_lines', rows); },
    }
  );

  const tillImports = Object.assign(
    makeRepo('till_imports'),
    {
      forEvent(eventId) {
        return select('till_imports', '?event_id=eq.' + enc(eventId) + '&select=*,rows:till_sale_rows(*)')
          .then((r) => (r && r[0]) || null);
      },
    }
  );

  const modifierImports = Object.assign(
    makeRepo('modifier_imports'),
    {
      forEvent(eventId) {
        return select('modifier_imports', '?event_id=eq.' + enc(eventId) + '&select=*,rows:modifier_sale_rows(*)')
          .then((r) => (r && r[0]) || null);
      },
    }
  );

  const recipes = Object.assign(
    makeRepo('recipes', { order: 'till_item' }),
    {
      listFull() {
        return select('recipes', '?select=*,ingredients:recipe_ingredients(*)&order=till_item');
      },
      ingredients(recipeId) {
        return select('recipe_ingredients', '?recipe_id=eq.' + enc(recipeId) + '&select=*&order=position');
      },
    }
  );

  const bugs = makeRepo('bug_reports', { order: 'created_at.desc' });

  // ---------- events repo (with composite read) ---------------------

  const events = Object.assign(
    makeRepo('events', { order: 'created_at.desc' }),
    {
      listActive() {
        return select('events', "?status=in.(draft,active,closing)&select=*&order=created_at.desc");
      },
      byLegacyId(legacyId) {
        return select('events', '?legacy_id=eq.' + enc(legacyId) + '&select=*')
          .then((r) => (r && r[0]) || null);
      },
      /**
       * Composite read: an event plus its directly-owned children in one
       * round trip (PostgREST embedded resources). Good enough for an
       * event dashboard; heavier collections (counts/transfers) are
       * fetched lazily via their own repos.
       */
      getFull(eventId) {
        return select(
          'events',
          '?' + eqId(eventId) +
          '&select=*' +
          ',bars:bars(*)' +
          ',recipients:recipients(*)' +
          ',event_products:event_products(*,product:products(id,name,case_size,units_per_case,case_price,abv,category:categories(id,name,colour_key)))'
        ).then((r) => (r && r[0]) || null);
      },
    }
  );

  // ---------- Public surface ----------------------------------------

  const DB = {
    // config
    configure, isConfigured, init,
    get config() { return Object.assign({}, cfg); },
    // core
    select, insert, upsert, update, remove, rpc,
    // storage
    uploadImage,
    // helpers
    _: { numOrNull, numOrZero, enc, makeRepo },
    // reference
    categories, suppliers, warehouses, caseSizes, products, productSuppliers, warehouseStock,
    // event-scoped
    events, eventProducts, bars, recipients, distribution, barProducts,
    stockCounts, closing, supplierReturns, transfers, deliveries, topups, wastage,
    tillImports, modifierImports,
    // global libraries
    recipes, bugs,
  };

  init();
  global.DB = DB;
})(typeof window !== 'undefined' ? window : globalThis);
