#!/usr/bin/env bash
# Run Playwright E2E from repo (Cursor terminal friendly).
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
  .venv/bin/playwright install chromium || true
fi

if [[ ! -f .env ]]; then
  echo "Missing e2e/.env — copy .env.example and fill SUPABASE_* + E2E_EMAIL/E2E_PASSWORD"
  exit 1
fi

# Prefer system Chrome when Playwright Chromium is not cached yet.
EXTRA=()
if [[ -z "${PLAYWRIGHT_CHANNEL:-}" ]] && [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  if [[ ! -d "$HOME/Library/Caches/ms-playwright/chromium-"* ]]; then
    export PLAYWRIGHT_CHANNEL=chrome
    EXTRA+=(--browser-channel chrome)
  fi
fi

exec .venv/bin/pytest "${EXTRA[@]}" "$@"
