/**
 * Planning → Export dialog: Designer, Client pack and Schedule of Rates as
 * PDF, Excel or CSV for the selected event and its price year. Every export
 * is written to the audit log; internal cost/GP columns are admin-only and
 * the export is refused if that audit write fails.
 */

import { escapeHtml, toast } from '../lib/util.js';
import { getDB } from '../db.js';
import { openModal, closeModal } from '../components/modal.js';
import { isOrgAdmin } from '../lib/organisations.js';
import { listAgreementsForEvent } from '../lib/accounts-data.js';
import { primaryContact, riderPricesFor } from '../lib/accounts.js';
import { EXPORT_TYPES, buildMenuExport, exportFileStem, menuExportCsv } from '../lib/menu-exports.js';

export function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * @param {{ eventId, event, year, lines: Map, scenarios: object[], accounts: object[]|null, clientAccountId: string|null }} ctx
 */
export function openMenuExportDialog(ctx) {
  const admin = isOrgAdmin();
  const client = (ctx.accounts || []).find((a) => a.id === ctx.clientAccountId) || null;
  const lines = [...ctx.lines.values()];
  const vatRate = lines.find((l) => l.included)?.vatRate ?? 0.2;
  let riderPrices = null;
  let riderNote = '';

  const scenarioChecks = ctx.scenarios.length
    ? ctx.scenarios.map((s) => `
        <label class="plan-check"><input type="checkbox" data-export-scenario="${escapeHtml(s.id)}" ${s.client_visible ? 'checked' : ''}>
          ${escapeHtml(s.name)}${s.client_visible ? '' : ' <span class="muted">· not marked client-visible</span>'}</label>`).join('')
    : '<p class="muted plan-export-note">No pricing scenarios on this event.</p>';

  const rateOpts = [
    '<option value="menu">Event menu prices</option>',
    client ? '<option value="rider" disabled>Rider agreement (loading…)</option>' : '',
    ...ctx.scenarios.map((s) => `<option value="${escapeHtml(s.id)}">Scenario · ${escapeHtml(s.name)}</option>`),
  ].join('');

  const el = openModal({
    title: 'Export menu',
    bodyHtml: `
      <div class="admin-drawer-form plan-export">
        <div class="plan-export-types" role="radiogroup" aria-label="Export type">
          ${Object.entries(EXPORT_TYPES).map(([key, spec], i) => `
            <label class="plan-export-type">
              <input type="radio" name="planExportType" value="${key}" ${i === 0 ? 'checked' : ''}>
              <span class="plan-export-type-title">${escapeHtml(spec.label)}</span>
              <span class="plan-export-type-copy">${key === 'designer'
                ? 'Menu names, products, categories and selling prices'
                : key === 'client' ? 'Product mix, menu prices and chosen scenarios' : 'Agreed products, units and rates — client-facing'}</span>
            </label>`).join('')}
        </div>
        <label class="admin-field"><span class="admin-label">Format</span>
          <select class="admin-select" id="planExportFormat">
            <option value="pdf">PDF (house style)</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </select></label>
        <div data-export-section="client" hidden>
          <span class="admin-label">Scenarios to include</span>
          ${scenarioChecks}
          ${admin ? `
            <label class="plan-check plan-export-internal"><input type="checkbox" id="planExportInternal">
              Include internal cost per serve and GP %</label>
            <p class="plan-export-warn" id="planExportInternalWarn" hidden>Internal figures will be marked on the document and this export is recorded in the audit log. Don’t send it to clients.</p>` : ''}
        </div>
        <div data-export-section="sor" hidden>
          <label class="admin-field"><span class="admin-label">Rates from</span>
            <select class="admin-select" id="planExportRate">${rateOpts}</select></label>
          ${client ? '' : '<p class="muted plan-export-note">Set a client account in the settings bar to address the schedule and use rider rates.</p>'}
        </div>
        <p class="plan-export-summary" id="planExportSummary"></p>
        <p class="plan-form-err" id="planExportErr" hidden></p>
      </div>`,
    footHtml: `
      <div class="admin-modal-confirm-foot">
        <button type="button" class="admin-drawer-btn admin-drawer-btn--solid" data-cancel>Cancel</button>
        <button type="button" class="admin-drawer-btn admin-drawer-btn--primary" data-ok>Export</button>
      </div>`,
  });

  const $q = (sel) => el.querySelector(sel);
  const type = () => $q('input[name="planExportType"]:checked')?.value || 'designer';
  const includeInternal = () => admin && type() === 'client' && !!$q('#planExportInternal')?.checked;

  function options() {
    return {
      lines,
      scenarios: ctx.scenarios,
      scenarioIds: [...el.querySelectorAll('[data-export-scenario]:checked')].map((c) => c.dataset.exportScenario),
      rateSource: $q('#planExportRate')?.value || 'menu',
      riderPrices,
      includeInternal: includeInternal(),
    };
  }

  function refresh() {
    const t = type();
    el.querySelectorAll('[data-export-section]').forEach((s) => { s.hidden = s.dataset.exportSection !== t; });
    const warn = $q('#planExportInternalWarn');
    if (warn) warn.hidden = !includeInternal();
    const model = buildMenuExport(t, options());
    const bits = [
      `${model.count} item${model.count === 1 ? '' : 's'}`,
      ctx.year?.label ? `price year ${ctx.year.label}` : 'no price year set',
      client ? `client ${client.name}` : null,
    ].filter(Boolean);
    let extra = '';
    if (model.missingRates) {
      extra = t === 'sor'
        ? ` · ${model.missingRates} unpriced item${model.missingRates === 1 ? '' : 's'} left off`
        : ` · ${model.missingRates} without a menu price`;
    }
    $q('#planExportSummary').textContent = `${bits.join(' · ')}${extra}`;
    $q('[data-ok]').disabled = model.count === 0;
  }

  el.addEventListener('change', refresh);
  $q('[data-cancel]').onclick = closeModal;

  if (client) {
    listAgreementsForEvent(ctx.eventId, client.id)
      .then((agreements) => {
        riderPrices = riderPricesFor(agreements, ctx.event);
        const opt = $q('#planExportRate option[value="rider"]');
        if (!opt) return;
        const names = [...new Set([...riderPrices.values()].map((r) => r.agreementName))];
        riderNote = names.length ? `rates per ${names.join(', ')}` : '';
        opt.disabled = riderPrices.size === 0;
        opt.textContent = riderPrices.size
          ? `Rider agreement · ${names.join(', ')} (${riderPrices.size} rate${riderPrices.size === 1 ? '' : 's'})`
          : 'Rider agreement (none active for this event)';
        if (riderPrices.size) $q('#planExportRate').value = 'rider';
        refresh();
      })
      .catch(() => {
        const opt = $q('#planExportRate option[value="rider"]');
        if (opt) opt.textContent = 'Rider agreement (unavailable)';
      });
  }

  $q('[data-ok]').onclick = async () => {
    const err = $q('#planExportErr');
    err.hidden = true;
    const t = type();
    const format = $q('#planExportFormat').value;
    const opts = options();
    const model = buildMenuExport(t, opts);
    if (!model.count) return;
    const btn = $q('[data-ok]');
    btn.disabled = true;

    const detail = {
      type: t,
      format,
      price_year: ctx.year?.label || null,
      items: model.count,
      scenarios: opts.scenarioIds,
      rate_source: t === 'sor' ? opts.rateSource : null,
      internal: model.includeInternal,
    };
    try {
      await getDB().rpc('log_audit_event', {
        p_kind: model.includeInternal ? 'menu_export_internal' : 'menu_export',
        p_ref: ctx.eventId,
        p_detail: detail,
      });
    } catch (e) {
      if (model.includeInternal) {
        btn.disabled = false;
        err.textContent = 'Couldn’t record the internal export in the audit log, so it was not created.';
        err.hidden = false;
        return;
      }
    }

    const spec = EXPORT_TYPES[t];
    const stem = exportFileStem(t, ctx.event?.name, ctx.year?.label);
    const rateNote = t === 'sor' && opts.rateSource === 'rider' ? riderNote : '';
    try {
      if (format === 'csv') {
        downloadBlob(`${stem}.csv`, menuExportCsv(model), 'text/csv;charset=utf-8');
      } else if (format === 'xlsx') {
        const { buildMenuExportXlsx } = await import('../lib/menu-export-xlsx.js');
        const vatPct = Math.round(vatRate * 1000) / 10;
        const bytes = buildMenuExportXlsx({
          model,
          title: `${spec.title} — ${ctx.event?.name || 'Event'}`,
          meta: [
            client?.name,
            ctx.year?.label ? `Price year ${ctx.year.label}` : null,
            `Prices in GBP inc VAT ${vatPct}%`,
            rateNote,
          ],
          notes: model.includeInternal ? ['INTERNAL — contains costs and GP. Not for distribution.'] : [],
          sheetName: spec.label,
        });
        downloadBlob(`${stem}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else {
        const { generateMenuExportPDF } = await import('../lib/menu-export-pdf.js');
        await generateMenuExportPDF({
          type: t,
          model,
          event: ctx.event,
          year: ctx.year,
          client: client ? { name: client.name, contact: primaryContact(client.account_contacts, 'account_manager') } : null,
          vatRate,
          rateNote,
        });
      }
      closeModal();
      toast(`${spec.label} exported`);
    } catch (e) {
      btn.disabled = false;
      err.textContent = e.message || 'Export failed';
      err.hidden = false;
    }
  };

  refresh();
}
