#!/usr/bin/env bash
# Replays every migration on a throwaway local Postgres, then runs the SQL
# tests in this folder. Usage: scripts/migration-test/run.sh [port]
# Requires a Postgres server reachable on /tmp:<port> with trust auth, e.g.
#   initdb -D /tmp/msdb -U postgres -A trust
#   pg_ctl -D /tmp/msdb -o "-p 54399 -k /tmp" start
set -euo pipefail

PORT="${1:-54399}"
DB="ms_migration_test"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/migration-test"
PSQL=(psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
"${PSQL[@]}" -d "$DB" -f "$HERE/supabase-stub.sql"

STRICT_FROM="${STRICT_FROM:-065}"
while IFS= read -r f; do
  name="$(basename "$f")"
  if ! "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$HERE/.last-err"; then
    # Older data-fix migrations target specific prod rows and can fail on an
    # empty database; new migrations must always apply cleanly.
    if [[ "${name:0:3}" < "$STRICT_FROM" ]]; then
      echo "warn: $name skipped on empty db ($(head -1 "$HERE/.last-err"))"
    else
      echo "FAILED: $name"; cat "$HERE/.last-err"; exit 1
    fi
  fi
done < <(find "$ROOT/migrations" -maxdepth 1 -name '[0-9]*.sql' | sort)
echo "migrations applied"

status=0
while IFS= read -r t; do
  if "${PSQL[@]}" -d "$DB" -f "$t"; then
    echo "PASS $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"; status=1
  fi
done < <(find "$HERE" -maxdepth 1 -name 'test_*.sql' | sort)
exit $status
