/**
 * setup.js — first-admin bootstrap wizard (no existing admin required).
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
    flowType: 'pkce',
  },
});

const msg = document.getElementById('msg');
const form = document.getElementById('setupForm');
const closedView = document.getElementById('closedView');
const submitBtn = document.getElementById('submitBtn');

function setMsg(text, kind = '') {
  if (!msg) return;
  msg.textContent = text;
  msg.className = 'sub' + (kind ? ` ${kind}` : '');
}

async function checkNeeded() {
  const res = await fetch('/api/auth/bootstrap');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMsg(data.message || data.error || 'Setup is not available.', 'error');
    closedView.hidden = false;
    return false;
  }
  if (!data.needed) {
    setMsg('Setup is closed — an admin already exists.', '');
    closedView.hidden = false;
    return false;
  }
  setMsg('Create the first admin account for Measured Stock.');
  form.hidden = false;
  return true;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const display_name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const password2 = document.getElementById('password2').value;

  if (password !== password2) {
    setMsg('Passwords do not match.', 'error');
    return;
  }
  if (password.length < 8) {
    setMsg('Password must be at least 8 characters.', 'error');
    return;
  }

  submitBtn.disabled = true;
  setMsg('Creating admin account…');

  try {
    const res = await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || `setup ${res.status}`);
    }

    setMsg('Signing you in…', 'ok');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Cookie may already be set — still send them to admin
      setMsg('Account created. Continue to the app.', 'ok');
      window.location.href = data.redirect || '/'
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.access_token) {
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: sessionData.session.access_token,
          display_name,
        }),
      }).catch(() => {});
    }

    window.location.href = data.redirect || '/'
  } catch (err) {
    setMsg(String(err.message || err), 'error');
    submitBtn.disabled = false;
  }
});

checkNeeded().catch((err) => {
  setMsg(String(err.message || err), 'error');
  closedView.hidden = false;
});
