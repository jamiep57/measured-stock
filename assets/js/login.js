/**
 * login.js — Supabase Auth sign-in (email/password).
 * Loaded as an ES module from /login.html.
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
const loginView = document.getElementById('loginView');
const pendingView = document.getElementById('pendingView');
const emailForm = document.getElementById('emailForm');
const emailBtn = document.getElementById('emailBtn');
const pendingSignOut = document.getElementById('pendingSignOut');

// Offer setup wizard when no admin exists yet
fetch('/api/auth/bootstrap')
  .then((r) => r.json())
  .then((data) => {
    if (data?.needed) {
      const el = document.getElementById('msg');
      if (el && !el.classList.contains('error')) {
        el.innerHTML = 'No admin yet — <a href="/setup">create the first admin account</a>.';
      }
    }
  })
  .catch(() => {});

function setMsg(text, kind = '') {
  if (!msg) return;
  msg.textContent = text;
  msg.className = 'sub' + (kind ? ` ${kind}` : '');
}

function showPending() {
  loginView.hidden = true;
  pendingView.hidden = false;
  setMsg('Awaiting approval', '');
}

function showLogin() {
  loginView.hidden = false;
  pendingView.hidden = true;
}

async function establishEdgeSession(accessToken) {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === 'pending') {
      showPending();
      return { pending: true };
    }
    if (res.status === 404 || res.status === 405) {
      return { ok: true, redirect: '/v5/admin', local: true };
    }
    if (!res.ok) {
      throw new Error(data.error || `session ${res.status}`);
    }
    return data;
  } catch (err) {
    if (String(err.message || '').includes('Failed to fetch') || err.name === 'TypeError') {
      return { ok: true, redirect: '/v5/admin', local: true };
    }
    throw err;
  }
}

async function checkProfileLocal(accessToken) {
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user?.id) throw new Error('no_user');
  const res = await fetch(
    `${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`,
    {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) throw new Error(`profile ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

async function finishSignIn(session) {
  if (!session?.access_token) {
    setMsg('Sign-in failed — no session.', 'error');
    return;
  }
  setMsg('Checking access…');
  try {
    const result = await establishEdgeSession(session.access_token);
    if (result.pending) return;

    if (result.local) {
      const profile = await checkProfileLocal(session.access_token);
      if (!profile || profile.status === 'pending') {
        showPending();
        return;
      }
      if (profile.status !== 'active') {
        setMsg('Your account is disabled. Contact an admin.', 'error');
        return;
      }
      const next = profile.role === 'staff' ? '/v5/' : '/v5/admin';
      window.location.href = next;
      return;
    }

    const next = result.redirect || '/v5/admin';
    window.location.href = next;
  } catch (err) {
    setMsg(String(err.message || err), 'error');
  }
}

emailForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  emailBtn.disabled = true;
  setMsg('Signing in…');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setMsg(error.message, 'error');
    emailBtn.disabled = false;
    return;
  }
  await finishSignIn(data.session);
  emailBtn.disabled = false;
});

if (emailForm) emailForm.setAttribute('data-ready', '1');

pendingSignOut?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
  setMsg('Signed out. You can sign in again once approved.');
});

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pending') === '1') {
    showPending();
    setMsg('Awaiting approval', '');
  } else if (params.get('error')) {
    setMsg(params.get('error_description') || params.get('error'), 'error');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session && params.get('pending') !== '1') {
    await finishSignIn(session);
  }
})();
