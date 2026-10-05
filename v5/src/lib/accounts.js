/**
 * Accounts (clients + suppliers) — pure helpers shared by the Accounts
 * page, the account picker and exports.
 */

export const CONTACT_ROLES = [
  { value: 'account_manager', label: 'Account manager' },
  { value: 'order', label: 'Orders' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'accounts', label: 'Accounts / invoices' },
  { value: 'other', label: 'Other' },
];

export const AGREEMENT_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'ended', label: 'Ended' },
];

export function roleLabel(role) {
  return CONTACT_ROLES.find((r) => r.value === role)?.label || 'Other';
}

/** Same rule as the database unique index: case- and edge-space-insensitive. */
export function accountNameKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** Existing account with the same name (excluding `exceptId`), or null. */
export function findDuplicateAccount(name, accounts, exceptId = null) {
  const key = accountNameKey(name);
  if (!key) return null;
  return (accounts || []).find((a) => a.id !== exceptId && accountNameKey(a.name) === key) || null;
}

export function accountKinds(account) {
  const kinds = [];
  if (account?.is_client) kinds.push('Client');
  if (account?.is_supplier) kinds.push('Supplier');
  return kinds;
}

export function matchesKind(account, kind) {
  if (kind === 'client') return !!account?.is_client;
  if (kind === 'supplier') return !!account?.is_supplier;
  return true;
}

/** Primary contact for a role, else the first contact with that role. */
export function primaryContact(contacts, role) {
  const list = (contacts || []).filter((c) => c.role === role);
  return list.find((c) => c.is_primary) || list[0] || null;
}

export function contactsByRole(contacts) {
  const groups = new Map(CONTACT_ROLES.map((r) => [r.value, []]));
  (contacts || []).forEach((c) => {
    const key = groups.has(c.role) ? c.role : 'other';
    groups.get(key).push(c);
  });
  groups.forEach((list) => list.sort((a, b) => (b.is_primary - a.is_primary) || a.name.localeCompare(b.name)));
  return groups;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate an account form. Returns { ok, errors: { field: message }, value }.
 */
export function validateAccount(form, accounts = [], exceptId = null) {
  const errors = {};
  const name = String(form?.name ?? '').trim();
  if (!name) errors.name = 'Name is required';
  else if (name.length > 120) errors.name = 'Name is too long';
  else {
    const dup = findDuplicateAccount(name, accounts, exceptId);
    if (dup) errors.name = `“${dup.name}” already exists`;
  }
  const email = String(form?.email ?? '').trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email';
  if (!form?.is_client && !form?.is_supplier) errors.kind = 'Choose client, supplier or both';
  const value = {
    name,
    is_client: !!form?.is_client,
    is_supplier: !!form?.is_supplier,
    legal_name: String(form?.legal_name ?? '').trim() || null,
    email: email || null,
    phone: String(form?.phone ?? '').trim() || null,
    address: String(form?.address ?? '').trim() || null,
    website: String(form?.website ?? '').trim() || null,
    vat_number: String(form?.vat_number ?? '').trim() || null,
    notes: String(form?.notes ?? '').trim() || null,
  };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validateContact(form, existing = [], exceptId = null) {
  const errors = {};
  const name = String(form?.name ?? '').trim();
  const role = CONTACT_ROLES.some((r) => r.value === form?.role) ? form.role : 'other';
  if (!name) errors.name = 'Name is required';
  else if ((existing || []).some((c) => c.id !== exceptId && c.role === role && accountNameKey(c.name) === accountNameKey(name))) {
    errors.name = `${name} is already a ${roleLabel(role).toLowerCase()} contact`;
  }
  const email = String(form?.email ?? '').trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'Enter a valid email';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      role,
      job_title: String(form?.job_title ?? '').trim() || null,
      email: email || null,
      phone: String(form?.phone ?? '').trim() || null,
      is_primary: !!form?.is_primary,
      notes: String(form?.notes ?? '').trim() || null,
    },
  };
}

/** Does an agreement apply to an event (status, event link, dates)? */
export function agreementAppliesTo(agreement, event) {
  if (!agreement || agreement.status !== 'active') return false;
  if (agreement.event_id && agreement.event_id !== event?.id) return false;
  const start = event?.start_date || null;
  const end = event?.end_date || start;
  if (agreement.valid_from && end && agreement.valid_from > end) return false;
  if (agreement.valid_to && start && agreement.valid_to < start) return false;
  return true;
}

/**
 * Rider price per product for an account at an event: event-specific
 * agreements win, then the newest general agreement.
 * Mirrors public.rider_price_for().
 */
export function riderPricesFor(agreements, event) {
  const applicable = (agreements || [])
    .filter((a) => agreementAppliesTo(a, event))
    .sort((a, b) => (Number(!!b.event_id) - Number(!!a.event_id))
      || String(b.valid_from || '').localeCompare(String(a.valid_from || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const out = new Map();
  applicable.forEach((a) => {
    (a.rider_price_lines || []).forEach((l) => {
      if (!out.has(l.product_id)) {
        out.set(l.product_id, {
          price: Number(l.price), unitLabel: l.unit_label || null, agreementId: a.id, agreementName: a.name,
        });
      }
    });
  });
  return out;
}
