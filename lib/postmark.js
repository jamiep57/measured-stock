// =====================================================================
// postmark.js — transactional email via Postmark HTTP API
// =====================================================================
// Server-only. Never import from browser bundles.
// Templates live in Postmark (Template aliases); this helper only sends.
//
// Env:
//   POSTMARK_SERVER_TOKEN  — Server API token
//   POSTMARK_FROM_EMAIL    — verified From address (e.g. live@measured.events)
// =====================================================================

const POSTMARK_URL = 'https://api.postmarkapp.com/email/withTemplate';

function assertEnv() {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  if (!token) {
    throw new Error('postmark: POSTMARK_SERVER_TOKEN is not set');
  }
  if (!from) {
    throw new Error('postmark: POSTMARK_FROM_EMAIL is not set');
  }
  return { token, from };
}

/**
 * Send a Postmark template email.
 * @param {{
 *   to: string,
 *   templateAlias: string,
 *   templateModel?: Record<string, unknown>,
 *   replyTo?: string,
 *   tag?: string,
 * }} opts
 */
export async function sendTemplateEmail(opts) {
  const { token, from } = assertEnv();
  const to = String(opts.to || '').trim();
  const templateAlias = String(opts.templateAlias || '').trim();
  if (!to || !templateAlias) {
    throw new Error('postmark: to and templateAlias are required');
  }

  const res = await fetch(POSTMARK_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      TemplateAlias: templateAlias,
      TemplateModel: opts.templateModel || {},
      ReplyTo: opts.replyTo || undefined,
      Tag: opts.tag || undefined,
      MessageStream: 'outbound',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.Message || res.statusText || `HTTP ${res.status}`;
    throw new Error(`postmark: ${msg}`);
  }
  return body;
}

/**
 * Notify a user that an admin activated their account.
 * Template alias: auth-account-approved
 */
export async function sendAccountApprovedEmail({ to, displayName, loginUrl }) {
  return sendTemplateEmail({
    to,
    templateAlias: 'auth-account-approved',
    tag: 'auth-account-approved',
    templateModel: {
      display_name: displayName || 'there',
      login_url: loginUrl || '',
      product_name: 'Measured Stock',
    },
  });
}

/**
 * Notify a user they were invited.
 * Template alias: auth-invite
 */
export async function sendInviteEmail({ to, displayName, inviteUrl, inviterName }) {
  return sendTemplateEmail({
    to,
    templateAlias: 'auth-invite',
    tag: 'auth-invite',
    templateModel: {
      display_name: displayName || 'there',
      invite_url: inviteUrl || '',
      inviter_name: inviterName || 'an admin',
      product_name: 'Measured Stock',
    },
  });
}

export default {
  sendTemplateEmail,
  sendAccountApprovedEmail,
  sendInviteEmail,
};
