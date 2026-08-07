/**
 * onboard.js — invitee sets name + password after opening an admin invite link.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2/+esm';

const BUILTIN = {
  url: 'https://qqdvzcaukstfdixnfuqq.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxZHZ6Y2F1a3N0ZmRpeG5mdXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTg2NzQsImV4cCI6MjA5MjM3NDY3NH0.pEli5ZEliJIwBTsNLb5JW4mFW1nV1TAnUO0f5_1UhGU',
};

function cloudConfig() {
  try {
    if (window.__CLOUD_CONFIG__?.url && window.__CLOUD_CONFIG__?.key) {
      return {
        url: String(window.__CLOUD_CONFIG__.url).replace(/\/$/, ''),
        key: window.__CLOUD_CONFIG__.key,
      };
    }
    const raw = localStorage.getItem('measured_stock_cloud');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.url && parsed?.key) {
        return { url: String(parsed.url).replace(/\/$/, ''), key: parsed.key };
      }
    }
  } catch { /* ignore */ }
  return { url: BUILTIN.url, key: BUILTIN.key };
}

const cfg = cloudConfig();
const supabase = createClient(cfg.url, cfg.key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

const msg = document.getElementById('msg');
const form = document.getElementById('onboardForm');
const invalidView = document.getElementById('invalidView');
const submitBtn = document.getElementById('submitBtn');
const emailInput = document.getElementById('email');
const nameInput = document.getElementById('name');

function setMsg(text, kind = '') {
  if (!msg) return;
  msg.textContent = text;
  msg.className = 'sub' + (kind ? ` ${kind}` : '');
}

function showInvalid(detail) {
  form.hidden = true;
  invalidView.hidden = false;
  setMsg(detail || 'Invite invalid.', 'error');
}

async function establishEdgeSession(accessToken, displayName) {
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      display_name: displayName,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.error === 'pending') {
    throw new Error('Your account is still awaiting admin approval.');
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `session ${res.status}`);
  }
  return data;
}

async function resolveInviteSession() {
  // Invite verify redirects here with tokens in the URL; supabase-js picks them up.
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (session) return session;

  // Some flows land with ?code= — exchange if present
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    const { data, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) throw exErr;
    return data.session;
  }
  return null;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const display_name = nameInput.value.trim();
  const password = document.getElementById('password').value;
  const password2 = document.getElementById('password2').value;

  if (!display_name) {
    setMsg('Enter your name.', 'error');
    return;
  }
  if (password.length < 8) {
    setMsg('Password must be at least 8 characters.', 'error');
    return;
  }
  if (password !== password2) {
    setMsg('Passwords do not match.', 'error');
    return;
  }

  submitBtn.disabled = true;
  setMsg('Saving your account…');

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showInvalid('Your invite session expired. Ask for a new link.');
      return;
    }

    const { error: updErr } = await supabase.auth.updateUser({
      password,
      data: { full_name: display_name, name: display_name },
    });
    if (updErr) throw updErr;

    // Best-effort profile name update (RLS allows own display_name)
    try {
      await fetch(
        `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ display_name }),
        }
      );
    } catch { /* ignore */ }

    const { data: refreshed } = await supabase.auth.getSession();
    const token = refreshed?.session?.access_token || session.access_token;
    const result = await establishEdgeSession(token, display_name);
    setMsg('All set — opening the app…', 'ok');
    window.location.href = result.redirect || '/v5/admin';
  } catch (err) {
    setMsg(String(err.message || err), 'error');
    submitBtn.disabled = false;
  }
});

(async () => {
  try {
    const session = await resolveInviteSession();
    if (!session?.user) {
      showInvalid();
      return;
    }

    const email = session.user.email || '';
    emailInput.value = email;
    const metaName =
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      (email ? email.split('@')[0] : '');
    if (metaName) nameInput.value = String(metaName).slice(0, 40);

    setMsg('Choose a password to finish setting up your account.');
    form.hidden = false;

    // Clean tokens from the address bar without dropping the session
    if (window.location.hash || window.location.search.includes('code=')) {
      history.replaceState({}, '', '/onboard');
    }
  } catch (err) {
    showInvalid(String(err.message || err));
  }
})();
