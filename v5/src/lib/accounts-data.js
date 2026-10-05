/**
 * Accounts data access (migration 071). Accounts + contacts are readable
 * by all members; writes and rider pricing are admin-only under RLS.
 */

import { getDB, invalidateRefCaches } from '../db.js';

const enc = (v) => encodeURIComponent(v);

export function isAccountsSchemaMissing(err) {
  const msg = String(err?.message || err || '');
  return /PGRST205|42P01|42703|does not exist|Could not find the table|schema cache/i.test(msg)
    && /accounts|account_contacts|rider_price|client_account_id/i.test(msg);
}

/** Friendlier message for the unique-name index. */
export function accountErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (/accounts_org_name_key|23505/.test(msg)) return 'An account with that name already exists';
  if (/account_contacts_dedupe_key/.test(msg)) return 'That person is already a contact in this role';
  if (/account_contacts_one_primary/.test(msg)) return 'There is already a primary contact for this role';
  if (/rider_price_lines_agreement_product_key/.test(msg)) return 'That product is already on this agreement';
  return msg || 'Save failed';
}

function cleanPatch(patch) {
  const out = {};
  Object.entries(patch || {}).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v === '' ? null : v;
  });
  return out;
}

let accountsCache = null;

export function invalidateAccounts() {
  accountsCache = null;
}

/** Account edits can create or rename suppliers (071 sync triggers). */
function invalidateAfterAccountWrite() {
  accountsCache = null;
  invalidateRefCaches();
}

export async function listAccounts({ force = false } = {}) {
  if (!force && accountsCache && Date.now() - accountsCache.at < 60_000) return accountsCache.value;
  const value = await getDB().select(
    'accounts',
    '?select=*,account_contacts(id,name,role,job_title,email,phone,is_primary,notes)&order=name.asc',
  );
  accountsCache = { at: Date.now(), value: value || [] };
  return accountsCache.value;
}

export async function createAccount(fields) {
  const rows = await getDB().insert('accounts', cleanPatch(fields));
  invalidateAfterAccountWrite();
  return rows?.[0] || null;
}

export async function updateAccount(id, patch) {
  const rows = await getDB().update('accounts', `id=eq.${enc(id)}`, cleanPatch(patch));
  invalidateAfterAccountWrite();
  return rows?.[0] || null;
}

export async function createContact(accountId, fields) {
  if (fields.is_primary) await clearPrimary(accountId, fields.role);
  const rows = await getDB().insert('account_contacts', cleanPatch({ ...fields, account_id: accountId }));
  invalidateAccounts();
  return rows?.[0] || null;
}

export async function updateContact(id, accountId, fields) {
  if (fields.is_primary) await clearPrimary(accountId, fields.role, id);
  const rows = await getDB().update('account_contacts', `id=eq.${enc(id)}`, cleanPatch(fields));
  invalidateAccounts();
  return rows?.[0] || null;
}

async function clearPrimary(accountId, role, exceptId = null) {
  let filter = `account_id=eq.${enc(accountId)}&role=eq.${enc(role)}&is_primary=eq.true`;
  if (exceptId) filter += `&id=neq.${enc(exceptId)}`;
  await getDB().update('account_contacts', filter, { is_primary: false });
}

export async function deleteContact(id) {
  await getDB().remove('account_contacts', `id=eq.${enc(id)}`);
  invalidateAccounts();
}

/** Events using an account as client, plus recipients linked to it. */
export async function accountUsage(accountId) {
  const [events, recipients] = await Promise.all([
    getDB().select('events', `?client_account_id=eq.${enc(accountId)}&select=id,name,start_date,status&order=start_date.desc.nullslast`),
    getDB().select('recipients', `?account_id=eq.${enc(accountId)}&select=id,name,department,event_id,event:events(name,start_date)`),
  ]);
  return { events: events || [], recipients: recipients || [] };
}

export function setEventClientAccount(eventId, accountId) {
  return getDB().update('events', `id=eq.${enc(eventId)}`, { client_account_id: accountId || null });
}

export async function loadEventClientAccount(eventId) {
  const rows = await getDB().select('events', `?id=eq.${enc(eventId)}&select=client_account_id`);
  return rows?.[0]?.client_account_id || null;
}

// ---------- rider pricing --------------------------------------------

export function listAgreements(accountId) {
  return getDB().select(
    'rider_price_agreements',
    `?account_id=eq.${enc(accountId)}&select=*,rider_price_lines(id,product_id,price,unit_label,notes)&order=created_at.desc`,
  );
}

export function listAgreementsForEvent(eventId, accountId = null) {
  const account = accountId ? `&account_id=eq.${enc(accountId)}` : '';
  return getDB().select(
    'rider_price_agreements',
    `?or=(event_id.eq.${enc(eventId)},event_id.is.null)&status=eq.active${account}&select=*,rider_price_lines(id,product_id,price,unit_label)`,
  );
}

export async function createAgreement(fields) {
  const rows = await getDB().insert('rider_price_agreements', cleanPatch(fields));
  return rows?.[0] || null;
}

export async function updateAgreement(id, patch) {
  const rows = await getDB().update('rider_price_agreements', `id=eq.${enc(id)}`, cleanPatch(patch));
  return rows?.[0] || null;
}

export function deleteAgreement(id) {
  return getDB().remove('rider_price_agreements', `id=eq.${enc(id)}`);
}

export async function upsertRiderLine(agreementId, productId, price) {
  if (price == null) {
    await getDB().remove('rider_price_lines', `agreement_id=eq.${enc(agreementId)}&product_id=eq.${enc(productId)}`);
    return null;
  }
  const rows = await getDB().upsert(
    'rider_price_lines',
    [{ agreement_id: agreementId, product_id: productId, price }],
    { onConflict: 'agreement_id,product_id' },
  );
  return rows?.[0] || null;
}
