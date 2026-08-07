/**
 * onboard.js — invitee sets name + password via app-owned invite link.
 * Expected URL: /onboard?invite=inv1.…
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
    detectSessionInUrl: false,
  },
});

const msg = document.getElementById('msg');
const form = document.getElementById('onboardForm');
const invalidView = document.getElementById('invalidView');
const submitBtn = document.getElementById('submitBtn');
const emailInput = document.getElementById('email');
const nameInput = document.getElementById('name');

const params = new URLSearchParams(window.location.search);
const invite = params.get('invite') || '';

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
    const acceptRes = await fetch('/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite, password, display_name }),
    });
    const accepted = await acceptRes.json().catch(() => ({}));
    if (!acceptRes.ok) {
      throw new Error(accepted.message || accepted.error || 'Could not finish setup');
    }

    setMsg('Signing you in…');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: accepted.email,
      password,
    });
    if (error) throw error;

    const sessionRes = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: data.session.access_token,
        display_name,
      }),
    });
    const sessionData = await sessionRes.json().catch(() => ({}));
    if (!sessionRes.ok) {
      throw new Error(sessionData.message || sessionData.error || 'session failed');
    }

    setMsg('All set — opening the app…', 'ok');
    window.location.href = sessionData.redirect || '/';
  } catch (err) {
    setMsg(String(err.message || err), 'error');
    submitBtn.disabled = false;
  }
});

(async () => {
  // Old Supabase verify links land with #access_token — explain and point to new flow
  if (window.location.hash.includes('access_token')) {
    showInvalid(
      'This is an old invite link. Ask an admin for a new invite from Users — it will look like measured-stock.vercel.app/onboard?invite=…'
    );
    return;
  }

  if (!invite) {
    showInvalid('Missing invite. Ask an admin for a new link.');
    return;
  }

  try {
    const res = await fetch(`/api/auth/accept-invite?invite=${encodeURIComponent(invite)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showInvalid(data.message || 'Invite link is invalid or expired.');
      return;
    }
    emailInput.value = data.email || '';
    nameInput.value = (data.email || '').split('@')[0].slice(0, 40);
    setMsg('Choose a name and password to finish setting up your account.');
    form.hidden = false;
  } catch (err) {
    showInvalid(String(err.message || err));
  }
})();
