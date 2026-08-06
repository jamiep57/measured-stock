/**
 * Printable paper count sheets — per-bar (Counts) or whole-event closing stock.
 */

import { escapeHtml, isBoneYard } from './util.js';
import { filterEventProductsForBar } from '../bar-products.js';
import { productStockPack } from '../pack-metrics.js';

function servingBars(bars) {
  return (bars || [])
    .filter((b) => !isBoneYard(b))
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function groupByCategory(eps) {
  const grouped = {};
  eps.forEach((ep) => {
    const cat = ep.product?.category?.name || 'Uncategorised';
    (grouped[cat] = grouped[cat] || []).push(ep);
  });
  Object.values(grouped).forEach((list) => {
    list.sort((a, b) => (a.product.name || '').localeCompare(b.product.name || ''));
  });
  return grouped;
}

function blankCell() {
  return '<td class="qty"><span class="box"></span></td>';
}

function productRowsHtml(eps, caseSizes) {
  const grouped = groupByCategory(eps);
  const cats = Object.keys(grouped).sort();
  let rows = '';

  cats.forEach((cat) => {
    rows += `<tr class="cat"><td colspan="4">${escapeHtml(cat)}</td></tr>`;
    grouped[cat].forEach((ep) => {
      const pack = productStockPack(ep.product, caseSizes);
      rows += `<tr>
        <td class="name">${escapeHtml(ep.product.name)}</td>
        <td class="pack">${escapeHtml(pack?.label || ep.product.case_size || '—')}</td>
        ${blankCell()}
        ${blankCell()}
      </tr>`;
    });
  });
  return rows;
}

function renderBarSheet(bar, eps, caseSizes, meta) {
  return `
    <section class="sheet">
      <header>
        <div class="brand">Stock count sheet</div>
        <h1>${escapeHtml(bar.name)}</h1>
        <div class="meta">
          <span><strong>Event</strong> ${escapeHtml(meta.eventName)}</span>
          <span><strong>Date</strong> _______________</span>
          <span><strong>Counted by</strong> _______________</span>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th class="name">Product</th>
            <th class="pack">Pack</th>
            <th class="qty">Cases</th>
            <th class="qty">Singles</th>
          </tr>
        </thead>
        <tbody>${productRowsHtml(eps, caseSizes)}</tbody>
      </table>
      <footer>
        <span>Products on ${escapeHtml(bar.name)} distribution · ${eps.length} item${eps.length === 1 ? '' : 's'}</span>
        <span>Checked _______________</span>
      </footer>
    </section>`;
}

function renderClosingSheet(eps, caseSizes, meta) {
  const title = meta.locationName || meta.eventName;
  const eventMeta = meta.locationName
    ? `<span><strong>Event</strong> ${escapeHtml(meta.eventName)}</span>`
    : '';
  const footLabel = meta.locationName
    ? `Closing stock · ${escapeHtml(meta.locationName)} · ${eps.length} item${eps.length === 1 ? '' : 's'}`
    : `Closing stock · ${eps.length} item${eps.length === 1 ? '' : 's'}`;
  return `
    <section class="sheet">
      <header>
        <div class="brand">Closing stock count</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">
          ${eventMeta}
          <span><strong>Date</strong> _______________</span>
          <span><strong>Counted by</strong> _______________</span>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th class="name">Product</th>
            <th class="pack">Pack</th>
            <th class="qty">Cases</th>
            <th class="qty">Singles</th>
          </tr>
        </thead>
        <tbody>${productRowsHtml(eps, caseSizes)}</tbody>
      </table>
      <footer>
        <span>${footLabel}</span>
        <span>Checked _______________</span>
      </footer>
    </section>`;
}

function wrapPrintHtml(title, sheetsHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${printStyles()}</style>
</head>
<body>
  ${sheetsHtml}
  <script>
    window.addEventListener('load', function () {
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`;
}

function openPrintWindow(html, blockedMsg) {
  const win = window.open('', '_blank');
  if (!win) return { error: blockedMsg };
  win.document.open();
  win.document.write(html);
  win.document.close();
  return null;
}

function printStyles() {
  return `
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 9.5px/1.15 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      page-break-after: always;
      break-after: page;
      padding-bottom: 4px;
    }
    .sheet:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    header { margin-bottom: 6px; }
    .brand {
      font-size: 8.5px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 1px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.1;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 14px;
      font-size: 9px;
      color: #222;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #222;
      padding: 1px 5px;
      vertical-align: middle;
      line-height: 1.15;
    }
    th {
      background: #eee;
      font-size: 8.5px;
      text-align: left;
      font-weight: 700;
      padding: 2px 5px;
    }
    tr.cat td {
      background: #f3f3f3;
      font-weight: 700;
      font-size: 8px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      padding: 1px 5px;
      line-height: 1.1;
    }
    td.name { width: auto; }
    th.pack, td.pack {
      width: 18%;
      color: #333;
      white-space: nowrap;
    }
    th.qty, td.qty {
      width: 11%;
      text-align: center;
      padding: 1px 3px;
    }
    .box {
      display: inline-block;
      width: 100%;
      min-height: 12px;
    }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 6px;
      font-size: 8.5px;
      color: #444;
    }
    @media screen {
      body { background: #e8e8e8; padding: 16px; }
      .sheet {
        background: #fff;
        max-width: 210mm;
        margin: 0 auto 16px;
        padding: 8mm;
        box-shadow: 0 1px 6px rgba(0,0,0,.15);
      }
    }
  `;
}

/**
 * Build printable HTML for one sheet per serving bar.
 * Products are limited to each bar's distribution menu (`bar_products`).
 * @returns {{ html: string, barCount: number, productCount: number } | { error: string }}
 */
export function buildCountSheetsHtml({ event, barProducts, caseSizes } = {}) {
  const bars = servingBars(event?.bars);
  if (!bars.length) return { error: 'Add bars in Event Setup before printing count sheets.' };

  const sheets = [];
  let productCount = 0;

  bars.forEach((bar) => {
    const eps = filterEventProductsForBar(event?.event_products, barProducts, bar.id);
    if (!eps.length) return;
    productCount += eps.length;
    sheets.push(renderBarSheet(bar, eps, caseSizes || [], {
      eventName: event?.name || 'Event',
    }));
  });

  if (!sheets.length) {
    return { error: 'No products are listed on any location in Distribution yet.' };
  }

  const eventName = event?.name || 'Event';
  const html = wrapPrintHtml(`Count sheets — ${eventName}`, sheets.join('\n'));

  return { html, barCount: sheets.length, productCount };
}

/** Open a print window with one paper count sheet per distribution location. */
export function printCountSheets(opts) {
  const result = buildCountSheetsHtml(opts);
  if (result.error) return result;

  const blocked = openPrintWindow(
    result.html,
    'Pop-up blocked — allow pop-ups to print count sheets.',
  );
  if (blocked) return blocked;
  return result;
}

/**
 * Build printable HTML for closing stock count sheet(s).
 * @param {'event'|'all'|'bar'} [opts.scope]
 *   - `event` — one whole-event sheet (all event products)
 *   - `all` — one sheet per serving bar (products from each bar’s distribution menu)
 *   - `bar` — one sheet for `opts.barId`
 * @returns {{ html: string, productCount: number, barCount?: number } | { error: string }}
 */
export function buildClosingCountSheetHtml({
  event,
  caseSizes,
  barProducts,
  scope = 'event',
  barId,
} = {}) {
  const eventName = event?.name || 'Event';
  const sizes = caseSizes || [];
  const mode = scope === 'all' || scope === 'bar' ? scope : 'event';

  if (mode === 'event') {
    const eps = (event?.event_products || []).filter((ep) => ep.product?.name);
    if (!eps.length) {
      return { error: 'Add products to this event before printing a closing count sheet.' };
    }
    const sheet = renderClosingSheet(eps, sizes, { eventName });
    const html = wrapPrintHtml(`Closing count — ${eventName}`, sheet);
    return { html, productCount: eps.length, barCount: 0 };
  }

  const bars = servingBars(event?.bars);
  if (!bars.length) {
    return { error: 'Add bars in Event Setup before printing location closing sheets.' };
  }

  const targetBars = mode === 'bar'
    ? bars.filter((b) => b.id === barId)
    : bars;

  if (mode === 'bar' && !targetBars.length) {
    return { error: 'Choose a location to print.' };
  }

  const sheets = [];
  let productCount = 0;

  targetBars.forEach((bar) => {
    const eps = filterEventProductsForBar(event?.event_products, barProducts, bar.id);
    if (!eps.length) return;
    productCount += eps.length;
    sheets.push(renderClosingSheet(eps, sizes, {
      eventName,
      locationName: bar.name,
    }));
  });

  if (!sheets.length) {
    return {
      error: mode === 'bar'
        ? 'No products are listed on this location in Distribution yet.'
        : 'No products are listed on any location in Distribution yet.',
    };
  }

  const title = mode === 'bar'
    ? `Closing count — ${targetBars[0].name}`
    : `Closing count — ${eventName}`;
  const html = wrapPrintHtml(title, sheets.join('\n'));

  return { html, productCount, barCount: sheets.length };
}

/** Open a print window with blank closing stock count sheet(s). */
export function printClosingCountSheet(opts) {
  const result = buildClosingCountSheetHtml(opts);
  if (result.error) return result;

  const blocked = openPrintWindow(
    result.html,
    'Pop-up blocked — allow pop-ups to print the closing count sheet.',
  );
  if (blocked) return blocked;
  return result;
}
