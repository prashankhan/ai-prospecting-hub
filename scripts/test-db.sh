#!/usr/bin/env bash
# Recreates the local test database and applies the auth stub + all migrations.
# Requires a local PostgreSQL 15+ reachable via TEST_DATABASE_ADMIN_URL (default: unix socket /tmp, port 54329).
set -euo pipefail
ADMIN_URL="${TEST_DATABASE_ADMIN_URL:-postgres://postgres@localhost:54329/postgres?host=/tmp}"
DB="${TEST_DATABASE_NAME:-aph_test}"
psql "$ADMIN_URL" -q -c "drop database if exists $DB with (force)" -c "create database $DB"
DB_URL="${ADMIN_URL%/postgres*}/$DB?${ADMIN_URL#*\?}"
for f in supabase/tests/local_auth_stub.sql supabase/migrations/*.sql; do
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "Migrated $DB"
