# AI Prospecting Hub

A project-based B2B prospect discovery, qualification and **human-assisted** outreach platform.
It discovers businesses, deduplicates them with database-enforced identity rules, researches and
qualifies them with a bounded AI agent, drafts personalized messages, and gives your team a focused
workspace to review, copy and send those messages themselves. Nothing is ever sent automatically.

The first configured project is **Tattoo IQ** (tattoo studio software, US/UK/Canada), but nothing
industry-specific is hard-coded — every project's targeting, qualification and messaging is set in
the UI.

---

## Contents

- [Status](#status)
- [Stack](#stack)
- [Configuration](#configuration)
- [Database setup](#database-setup)
- [First run](#first-run)
- [Background jobs](#background-jobs)
- [Deploying to Vercel](#deploying-to-vercel)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Testing](#testing)
- [Roadmap](#roadmap)

---

## Status

V1 is implemented. What has and hasn't been verified:

| Area | Verified |
| --- | --- |
| Schema, RLS, duplicate prevention, concurrency, isolation | ✅ PostgreSQL integration tests (`tests/db`) |
| Normalization, transitions, permissions, schemas, crypto, SSRF guard, CSV safety, provider error handling | ✅ Unit tests (`tests/unit`) |
| Full UI workflow (setup → project → import → dedupe → verify Instagram → draft → approve → Copy & Open → mark contacted → record response → reports → invite operator → isolation → mobile/dark) | ✅ Playwright run against the production build (`scripts/e2e.sh`) |
| Gemini adapter against the **live** API | ⚠️ Partially — the live API's invalid-key response is correctly classified. A successful generation needs a real key: run `GEMINI_API_KEY=… GEMINI_MODEL=… npm test -- tests/live` or use **Test connection** in Settings |
| Anthropic, OpenAI, OpenRouter adapters | ⚠️ Implemented and unit-tested with mocked HTTP; not verified against live APIs. The UI only shows a provider as **verified** after a successful connection test with the stored key |
| Google Places discovery | ⚠️ Implemented and unit-tested with mocked HTTP; requires a Places API (New) key to run real searches. Shows as **Not configured** until a key is saved |
| Against a hosted Supabase project | ⚠️ Not yet — credentials were not available in the build environment. The E2E run used a local PostgreSQL with the real migrations behind a minimal Auth/PostgREST test harness |

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS v4 ·
shadcn/ui-style components on Radix UI · Plus Jakarta Sans · Lucide · Supabase (Postgres, Auth, RLS) ·
Zod · Vitest · Playwright.

No ORM, no Redis, no separate worker service: jobs are durable rows in Postgres advanced by a cron
endpoint.

> Cache Components is deliberately disabled (`next.config.ts`): every screen is authenticated,
> per-user and per-project, so request-time rendering is the correct default.

## Configuration

Copy `.env.example` to `.env.local` for local development, or add the same variables in
**Vercel → Project → Settings → Environment Variables**.

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon (publishable) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Privileged operations after server-side authorization |
| `CREDENTIALS_ENCRYPTION_KEY` | **server only** | 32 random bytes, base64. Encrypts provider API keys (AES-256-GCM). Never stored in the database. Changing it makes stored keys unreadable — re-enter them in Settings |
| `SETUP_TOKEN` | **server only** | One-time token required to create the first administrator at `/setup` |
| `CRON_SECRET` | **server only** | At least 16 characters. Authenticates `/api/jobs/tick` (used by the Supabase scheduler and Vercel Cron) |
| `APP_URL` | server | Public https URL used in invitation links and by the job scheduler. Optional on Vercel (defaults to the production domain) |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Operational settings — AI providers and keys, models, discovery providers, duplicate policies, usage
limits, team and projects — are configured in the app, not in environment variables.

## Database setup

Migrations live in `supabase/migrations` and must be applied in filename order:

1. `…01_schema.sql` — tables, enums, indexes, constraints
2. `…02_security.sql` — authorization helpers, guard triggers, Row Level Security
3. `…03_functions.sql` — atomic identity ingestion, ambiguous-match resolution, do-not-contact, job leasing, reporting
4. `…04_seed_project.sql` — the initial, editable Tattoo IQ project (no prospect records)
5. `…05_harden_function_grants.sql` — tightened function privileges (Supabase security advisor)
6. `…06_job_worker_scheduler.sql` — free per-minute job scheduling with pg_cron/pg_net (skipped where unavailable)
7. `…07_web_discovery.sql` — pre-research identity lookups and remembered rejections for agent discovery

With the Supabase CLI:

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

```bash
supabase db push
```

Or paste each file into **Supabase → SQL Editor** in order.

Then in **Supabase → Authentication**:

- **Disable public sign-ups** (Sign In / Providers → Email → “Allow new users to sign up” off). Users join by invitation only.
- Add `APP_URL/auth/confirm` to **URL Configuration → Redirect URLs**.
- For invitation *emails*, configure SMTP (Supabase's built-in sender is heavily rate-limited). Without SMTP, use **Create invitation link** in Settings → Team and share the link yourself.

Regenerate TypeScript types after schema changes:

```bash
DATABASE_URL=postgres://… npm run db:types
```

## First run

1. Deploy (or `npm run dev`) with the environment variables above.
2. Open `/setup`, enter `SETUP_TOKEN`, and create the first administrator. Setup only works while no administrator exists and is rate-limited.
3. **Settings → AI providers**: paste a Gemini key, **Test connection** (this lists the models your key can use), pick a model, enable, save.
4. **Settings → Discovery providers** (optional): add a Google Maps Platform key with *Places API (New)* enabled. Or skip discovery and **Import CSV**.
5. Review the **Tattoo IQ** project configuration, then import or discover prospects.
6. Qualify prospects (Prospects → select → Qualify), generate messages, and work the **Outreach** queue.
7. Invite operators in **Settings → Team** and choose which projects they can access.

## Background jobs

Discovery searches and bulk AI jobs can outlive a request, so they are stored in the `jobs` table and
advanced in bounded slices:

- `claim_job()` takes a lease with `FOR UPDATE SKIP LOCKED`, enforces the concurrent-job limit, and prevents duplicate execution.
- Each slice processes one discovery page or up to 4 AI items within ~40 s, saves a cursor and releases the lease.
- Failures retry with back-off up to `max_attempts`; fatal errors (bad key, quota, usage cap) stop the job immediately. Per-record failures are logged without stopping the job.
- Cancellation is checked between records.

Slices are triggered by (all free — no paid plan required):

1. **The app itself** — after a job is created, `after()` keeps advancing it for ~50 s, so small jobs (one discovery page, a few qualifications) finish immediately.
2. **Supabase pg_cron + pg_net** (`…06_job_worker_scheduler.sql`) — every minute the database checks for pending jobs and, **only if there are any**, calls `GET /api/jobs/tick` with the `CRON_SECRET`. The app registers its URL and secret automatically (stored in Supabase Vault) the first time a job runs or the worker endpoint is called, so there's nothing to configure by hand.
3. **The job page** — while it's open, it nudges the job forward every few seconds.
4. **A daily Vercel Cron sweep** (`vercel.json`, compatible with the Hobby plan) as a last-resort safety net.

Jobs keep running after the browser closes via (2). The worker URL is `APP_URL`, or Vercel's production domain when `APP_URL` is unset.

## Deploying to Vercel

> Not deployed yet. When you're ready:

1. Import the repository in Vercel (framework: Next.js; defaults are fine).
2. Add all environment variables from [Configuration](#configuration) for Production (and Preview if you use it, ideally with a separate Supabase project).
3. Apply the migrations to the production Supabase project and complete the Auth settings above.
4. Deploy, then visit `/setup`.

## Architecture

```
src/
  app/(auth)/           login, setup, invitation confirm, set password
  app/(app)/            dashboard, projects, discover, prospects, outreach, reports, settings
  app/api/              jobs/tick (worker), prospects/export (CSV)
  components/ui/        design-system primitives (Radix + Tailwind tokens)
  components/…          feature components
  lib/identity/         normalization, identity keys, Instagram match classification (pure)
  lib/domain/           outreach status rules, permissions, policies (pure)
  lib/ai/               provider adapters, prompts, output schemas, provenance (pure)
  lib/discovery/        discovery provider adapters (pure)
  lib/research/         website extraction + robots.txt (pure) and fetching
  lib/security/         AES-GCM credential encryption, SSRF-safe fetch
  server/               session/authorization, agent pipeline, job runner, usage, actions, queries
supabase/migrations/    versioned SQL
tests/                  unit, db (PostgreSQL), live (opt-in), e2e (Playwright + harness)
```

**Agent pipeline** — `Discover → Normalize → Deduplicate → Research → Qualify → Generate → Review`,
each a bounded, tool-driven stage:

- *Discover*: a provider adapter returns raw business records; exclusions and closed businesses are filtered.
- *Normalize / Deduplicate*: `buildCandidate()` produces identity keys; `ingest_prospect_candidate()` resolves them atomically in Postgres.
- *Research*: fetches the business homepage (robots.txt respected, SSRF-guarded, size/time-bounded) and extracts **published** Instagram links and `mailto:` emails. Skipped when recent research exists and policy allows.
- *Qualify*: the model receives the project brief plus numbered source documents; untrusted content is fenced and sanitized. Output is Zod-validated (one repair retry). Evidence citing sources that weren't provided is discarded. The project threshold caps "qualified" recommendations.
- *Generate*: same provenance rules; every version is kept; a person must approve before Copy & Open is enabled.
- *Review*: humans approve drafts, verify Instagram profiles, resolve ambiguous identities, and confirm manual sends.

**Agent discovery (web search)** — the primary way to find prospects. Choose a provider in Settings → Discovery providers:

| Provider | Key needed | Notes |
| --- | --- | --- |
| Gemini · Google Search grounding | No (reuses the Gemini AI key) | Google bills grounded searches after a monthly free allowance |
| Serper | Serper API key | 2,500 free queries on sign-up |
| Brave Search API | Brave subscription token | See Brave's plans |
| Google Places (optional) | Maps Platform key | Structured listings; no Instagram verification step |

For each city the job plans a handful of queries (website-oriented and `site:instagram.com`), drops directories and listicles, and for every candidate:
1. checks `lookup_discovery_candidate()` first — businesses already in the project, on the do-not-contact list, or rejected within the refresh interval are skipped **without any fetch or AI call**;
2. fetches the business's own homepage (robots.txt, SSRF guard) and reads the Instagram links it publishes — an Instagram profile is **verified only when the business website links exactly one profile**; profiles found only in search results must have their website found and must be linked back, otherwise they're rejected (never marked verified);
3. asks Gemini to validate that the page is a single matching business; names, cities and countries the model returns are used only if they appear in the page or search result;
4. ingests through `ingest_prospect_candidate()` (atomic dedup), stores the research so qualification doesn't fetch again, and records rejections;
5. optionally queues AI qualification, then message drafts for qualified prospects. Outreach stays manual via Copy & Open Instagram.

Jobs stop at the requested prospect count or the per-job search budget, whichever comes first, and respect daily AI/discovery caps.

**Duplicate prevention** — identity keys (`instagram_username`, `instagram_id`, `place_id`, `domain`, `phone`) are unique in `identity_keys`; each business appears once per project (`unique (project_id, identity_id)`); ingestion takes advisory locks per key so concurrent imports can't race. Uncertain matches — same name and location without shared identifiers, a shared domain/phone with a different name, or conflicting identifiers — go to **Discover → Review matches** and are never merged automatically. Global identities are never readable by clients, so cross-project detection doesn't expose other projects' data.

**Instagram** — profiles are identified only from evidence (business website links, CSV values, manual verification). Status is *Verified* (website or manual evidence), *Likely match — review required*, *Not found*, or *Conflicting matches*. **Copy & Open Instagram** copies the approved message and opens the verified profile in a new tab; it never marks the prospect contacted and never sends anything. Instagram doesn't support pre-filled DMs.

## Security model

- Supabase Auth with SSR cookies; sessions refreshed in `src/proxy.ts`; every server action re-checks the user, role and project access (`authorize()`).
- RLS on every table. Operators only see projects they belong to; admins see all. Identity, credential and usage tables have no client policies.
- Database triggers enforce rules even for direct API calls: immutable prospect project/identity, admin-only assignment and do-not-contact lifting, status transitions (contact only from an approved message, no return to pre-contact), repeat-outreach blocking, append-only activity and audit logs.
- Provider keys: AES-256-GCM with an environment key; only a 4-character hint is ever returned to the browser; secrets are redacted from errors and logs.
- Retrieved web content is untrusted: fenced, sanitized, and the model is instructed never to follow instructions inside it; outputs are schema-validated with source provenance.
- Cost controls: daily AI and discovery caps, per-job result limits, batch limits, concurrent-job limit, explicit confirmation dialogs showing request estimates before paid jobs. Only administrators can start paid jobs (enforced by RLS on `jobs`).
- CSV: 2 MB / 1,000-row limits, server-side parsing, every row through the same duplicate checks; exports neutralize spreadsheet formulas.
- No automated or unsolicited social messaging. No Instagram scraping, login automation or CAPTCHA circumvention.

Known limitations: research fetches validate DNS before connecting but don't pin the resolved IP (DNS-rebinding window); activity rows are insertable by project members, so reports trust team members not to fabricate entries.

## Testing

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

Database integration tests run when `TEST_DATABASE_URL` points at a PostgreSQL 15+ database prepared
by `scripts/test-db.sh` (auth stub + migrations; defaults to a local server on port 54329):

```bash
./scripts/test-db.sh && TEST_DATABASE_URL="postgres://postgres@localhost:54329/aph_test?host=/tmp" npm test
```

End-to-end (local PostgreSQL + Playwright with Chromium):

```bash
./scripts/e2e.sh
```

`tests/e2e/fake-supabase.mjs` is a **test-only** harness that implements the subset of Supabase Auth
and PostgREST this app uses, on top of the real migrations and RLS. It is not a substitute for
Supabase and must never be deployed.

## Roadmap

**V1 (this release)** — design system, auth, projects, encrypted provider settings, Gemini + adapter
architecture, prospect database, CSV import/export, Google Places discovery, AI qualification and
messaging with provenance, strict duplicate prevention, outreach workspace, assignments, reports.

**V2 — advanced discovery** (schema already accommodates it): Outscraper and additional providers
(`DISCOVERY_PROVIDERS` + adapter), enhanced profile matching, bulk enrichment, larger jobs, research
caching and Places content retention handling, discovery analytics, per-provider usage budgets.

**V3 — advanced operations**: optional official Meta integration for eligible conversations, shared
inbox (navigation slot reserved; not shown in V1), AI reply suggestions, richer team workflows,
pipeline automation, trial-conversion analytics, more channels. Automated unsolicited DMs will not be
built.
