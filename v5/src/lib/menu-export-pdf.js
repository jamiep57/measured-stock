/**
 * Menu export PDFs (Designer, Client pack, Schedule of Rates) in the
 * Measured document style. Input is a sanitised model from buildMenuExport.
 */

import { BRAND, createBrandDoc, formatDocDate } from './brand-pdf.js';
import { EXPORT_TYPES, cellValue, exportFileStem, formatCell } from './menu-exports.js';

function eventDates(event) {
  if (!event?.start_date) return null;
  const a = formatDocDate(event.start_date);
  const b = event.end_date && event.end_date !== event.start_date ? formatDocDate(event.end_date) : null;
  return b ? `${a} – ${b}` : a;
}

/**
 * @param {{
 *   type: 'designer'|'client'|'sor',
 *   model: ReturnType<import('./menu-exports.js').buildMenuExport>,
 *   event: object, year?: object|null, client?: { name: string, contact?: object|null }|null,
 *   vatRate: number, rateNote?: string, preparedBy?: { name?: string, email?: string }|null,
 * }} input
 */
export async function generateMenuExportPDF({ type, model, event, year, client, vatRate, rateNote = '', preparedBy = null }) {
  if (!model.count) throw new Error('Nothing to export — no priced items on the event menu.');
  const spec = EXPORT_TYPES[type];
  const wide = model.columns.length > 5;
  const ctx = await createBrandDoc({ title: spec.title, orientation: wide ? 'landscape' : 'portrait' });
  ctx.continuationNote = event?.name || '';
  if (model.includeInternal) ctx.footerNote = 'INTERNAL — contains costs and GP. Not for distribution.';

  const vatPct = Math.round((Number(vatRate) || 0) * 1000) / 10;
  const parties = [];
  if (client?.name) {
    parties.push({ label: 'Client', lines: [client.name, client.contact?.name, client.contact?.email] });
  }
  parties.push({ label: 'Event', lines: [event?.name || '—', event?.venue, eventDates(event)] });
  if (type !== 'designer') {
    parties.push({
      label: 'Prepared by',
      lines: ['Measured', preparedBy?.name, preparedBy?.email || 'live@measured.events'],
    });
  }

  ctx.header({
    meta: [
      year?.label ? `Price year  ${year.label}` : null,
      `Issued  ${formatDocDate(new Date())}`,
    ],
    parties,
  });

  if (type === 'sor') {
    ctx.paragraph(
      `This schedule sets out the agreed products, units and rates for ${event?.name || 'the event'}`
      + `${client?.name ? ` for ${client.name}` : ''}. All rates are in pounds sterling and include VAT at ${vatPct}%`
      + `${rateNote ? ` · ${rateNote}` : ''}.`,
      { size: 9.5 },
    );
    ctx.y += 2;
  } else if (type === 'client') {
    const prices = model.groups.flatMap((g) => g.rows.map((r) => r.price)).filter((p) => p != null);
    const avg = prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null;
    ctx.kpis([
      { label: 'Products', value: String(model.count) },
      { label: 'Categories', value: String(model.groups.length) },
      { label: 'Average price', value: avg == null ? '—' : `£${avg.toFixed(2)}` },
      { label: 'Prices', value: `inc VAT ${vatPct}%` },
    ]);
  }

  const widths = {
    menuName: 34, productName: 30, serve: 14, price: 12, rate: 14, mixPct: 10, costPerServe: 12, gpPct: 9,
  };
  const columns = model.columns.map((c) => ({
    label: c.label,
    width: widths[c.key] || 13,
    align: c.align,
    muted: c.key === 'serve' || c.key === 'productName',
  }));

  const rows = [];
  model.groups.forEach((g) => {
    rows.push({ group: g.category });
    g.rows.forEach((r, i) => {
      rows.push({
        cells: model.columns.map((c) => formatCell(cellValue(r, c), c)),
        band: i % 2 === 1,
        bold: false,
      });
    });
  });
  ctx.table(columns, rows, { rowH: type === 'sor' ? 7.6 : 7, size: type === 'sor' ? 9.5 : 9 });

  if (type === 'sor') {
    ctx.y += 2;
    ctx.sectionTitle('Notes');
    [
      `Rates apply to ${event?.name || 'this event'}${year?.label ? ` in price year ${year.label}` : ''}.`,
      `Rates are per unit as listed, in GBP and inclusive of VAT at ${vatPct}%.`,
    ].forEach((t) => ctx.paragraph(`•  ${t}`, { size: 8.5 }));
  } else if (type === 'designer') {
    ctx.paragraph(`Prices include VAT at ${vatPct}%. Please use menu names exactly as shown.`, { size: 8.5, color: BRAND.muted });
  } else if (model.missingRates) {
    ctx.paragraph(`${model.missingRates} item${model.missingRates === 1 ? ' has' : 's have'} no menu price yet and show as —.`, { size: 8.5, color: BRAND.muted });
  }

  return ctx.finish(`${exportFileStem(type, event?.name, year?.label)}.pdf`);
}
