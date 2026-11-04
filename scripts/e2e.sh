#!/usr/bin/env bash
# Runs the end-to-end workflow: fresh local DB → fake Supabase → production build → Playwright.
# Requires local PostgreSQL (see scripts/test-db.sh) and Playwright with Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${TEST_DATABASE_URL:-postgres://postgres@localhost:54329/aph_test?host=/tmp}"
mkdir -p .local
for p in $(ps -eo pid,args | grep -E "fake-supabase.mjs|next-server" | grep -v grep | awk "{print \$1}"); do kill "$p" 2>/dev/null || true; done
sleep 1
./scripts/test-db.sh >/dev/null
DATABASE_URL="$DB_URL" node tests/e2e/fake-supabase.mjs > .local/fake.log 2>&1 &
echo $! > .local/fake.pid
sleep 2
ANON=$(grep ANON_KEY .local/fake.log | cut -d= -f2)
SERVICE=$(grep SERVICE_KEY .local/fake.log | cut -d= -f2)
cat > .env.local <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
CREDENTIALS_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
SETUP_TOKEN=e2e-setup-token
CRON_SECRET=e2e-cron-secret
APP_URL=http://localhost:3000
ENV
if [ "${SKIP_BUILD:-}" != "1" ]; then npx next build > .local/build.log 2>&1 || { tail -30 .local/build.log; exit 1; }; fi
npx next start -p 3000 > .local/next.log 2>&1 &
echo $! > .local/next.pid
sleep 3
status=0
NODE_PATH="$(npm root -g)" node tests/e2e/workflow.mjs || status=$?
kill "$(cat .local/next.pid)" "$(cat .local/fake.pid)" 2>/dev/null || true
rm -f .env.local
exit $status
