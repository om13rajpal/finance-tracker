# Finance Tracker

A personal finance tracker built for India: multi-account net worth, transactions with
auto-categorization, investments with FIFO cost-basis tracking, Gmail auto-ingestion of
bank and credit card alert emails, recurring transactions, budgets, and "guilt-free
money" conscious-spending planning. It also includes a tax module: FIFO capital gains
(STCG/LTCG), Section 80C deduction tracking, and a dual-regime (old vs. new) income tax
estimate.

## Features

- **Accounts and net worth**: bank, credit card, PPF, and cash accounts, with balance
  history and credit cards correctly treated as liabilities.
- **Transactions**: manual entry, CSV import, auto-categorization rules, and
  cross-source duplicate detection.
- **Gmail auto-ingestion**: watches your inbox for bank and card alert emails, parses
  them, and holds them in a review queue until you confirm.
- **Investments**: holdings with FIFO lot tracking, live pricing, and CSV import from
  Zerodha and Groww.
- **Budgets and goals**: category-based budgets with sub-category rollups, savings
  goals with progress tracking.
- **Recurring transactions**: EMIs, subscriptions, salary, and SIPs, with optional
  auto-creation.
- **Dashboard**: net worth, budget vs. spend, upcoming recurring items, and a
  conscious-spending "guilt-free money" breakdown.
- **Tax module**: capital gains classification, Section 80C deductions (manual and
  auto-populated), HRA exemption, and a side-by-side old vs. new regime tax estimate.
- **Data export**: full data download at any time.

## Layout

```
api/       Express + TypeScript API (Mongoose, BullMQ workers), deployed on Render
web/       Next.js App Router frontend (TanStack Query, Tailwind), deployed on Vercel
shared/    Shared TypeScript types
```

The browser only ever talks to `web`. `web` proxies `/api/*` through to the API
(`web/next.config.mjs`), so the auth cookie stays same-origin.

## Prerequisites

- Node.js 22 or newer, and pnpm 11 (`corepack enable`)
- MongoDB and Redis running on `localhost:27017` and `localhost:6379`

Start the datastores with Docker:

```bash
docker compose up -d          # mongo:7 + redis:7
```

Or run them natively (`brew services start mongodb-community@7.0 redis`). The API only
needs those two ports to be listening.

## First run

```bash
pnpm install
cp api/.env.example api/.env   # then fill in the values below
pnpm dev:api                   # http://localhost:4000
pnpm dev:web                   # http://localhost:3000
```

Open http://localhost:3000, sign in with the email you set as `ALLOWED_LOGIN_EMAIL`
(a one-time code is emailed via Resend), and you land on the dashboard.

### Environment variables (`api/.env`)

Every one of these is required. The API validates them with Zod at startup and refuses
to boot if any is missing (`api/src/config/env.ts`).

| Variable | What it is |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection string (`rediss://` for Upstash), used for BullMQ and caching |
| `JWT_SECRET` | Signing key for the session cookie and the Gmail OAuth state |
| `RESEND_API_KEY` | Resend API key, used to email login codes |
| `ALLOWED_LOGIN_EMAIL` | The single email address allowed to sign in |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` | Google OAuth client for Gmail ingestion |
| `GMAIL_PUBSUB_TOPIC` | Pub/Sub topic Gmail pushes watch notifications to |
| `GMAIL_WEBHOOK_SECRET` | Shared secret in the Pub/Sub push URL, checked by `POST /webhooks/gmail` |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex key (`openssl rand -hex 32`) encrypting the stored Gmail refresh token |
| `WEB_ORIGIN` | Frontend origin, used for CORS and post-OAuth redirects |

Generate your own `TOKEN_ENCRYPTION_KEY` and `JWT_SECRET`. The values in
`api/.env.example` are illustrative placeholders, not usable secrets.

## Day-to-day commands

```bash
pnpm test:api                       # API test suite (vitest, needs local Mongo and Redis)
pnpm --filter api exec tsc --noEmit # type-check the API
pnpm --filter web exec tsc --noEmit # type-check the frontend
pnpm lint                           # ESLint across the monorepo
pnpm format                         # Prettier
pnpm test:e2e                       # Playwright golden path (starts its own stack)
```

`pnpm test:e2e` runs against a real API and browser, so it needs Mongo and Redis up.

## Background workers

The API process runs seven BullMQ workers (`api/src/jobs/startWorkers.ts`): market
price refresh plus the job that schedules it, recurring-transaction due checks, Gmail
watch renewal, Gmail email parsing, monthly rollups, and price-snapshot retention. They
start automatically with the API. There is no separate worker process to run.

## Tax module

`/tax` covers capital gains (FIFO-matched, classified STCG or LTCG according to the
holding-period rules in `TaxSlabConfig`), Section 80C deductions (manual entries plus
totals auto-populated from ELSS-tagged mutual fund holdings; PPF stays manual, since a
balance history alone cannot reliably separate a contribution from interest credited),
income sources, and a side-by-side old vs. new regime tax estimate.

A few things worth knowing before trusting a number this module prints:

- **Tax rates and slabs are data, not code.** Every financial year's rules live in a
  `TaxSlabConfig` document (`financialYear` plus `regime`), managed through
  `POST /tax/slab-config`. The figures seeded for FY2025-26
  (`api/src/modules/tax/seed-fy2025-26.ts`, run manually and never wired into automatic
  app startup) are illustrative, not authoritative. Verify every number against the
  actual Income Tax Department notification for whichever financial year you are
  using before relying on the estimate for a real decision, and add each new
  financial year's config before using the module for that year. This is the one
  recurring manual maintenance task the module needs, expected every Union Budget.
- **ELSS auto-population needs `HoldingLot.isElss` set.** Reading `/tax/deductions` or
  `/tax/estimate` recomputes the `auto_elss` Section 80C total from lots tagged
  `isElss: true`, but nothing tags them automatically yet. The CSV importers do not
  know which funds are ELSS and there is no UI toggle, so the flag has to be set
  directly in the database today. Untagged ELSS purchases simply do not appear;
  enter them manually instead.
- **Only Section 80C is capped.** The estimate sums Section 80C deductions and caps
  that total at `section80CLimit`, which is correct. Every other section (80D,
  80CCD(1B), 24(b), and so on) is summed and added in full, with no cap, because this
  app does not model their real individual limits. Modelling that properly needs a
  per-section, per-regime limit table in `TaxSlabConfig`.
- **HRA exemption uses basic salary only, not basic plus dearness allowance.**
  `POST /tax/income-sources` accepts `breakdown.rentPaidAnnual` and
  `breakdown.isMetro` alongside `basic`, `hra`, and `allowances`. When present on a
  salary source, the old-regime estimate computes the standard Section 10(13A) HRA
  exemption (the minimum of actual HRA received, rent paid minus 10 percent of basic,
  and 40 or 50 percent of basic for non-metro or metro) and subtracts it from gross
  salary before tax. The new regime never applies this exemption. The textbook
  formula technically uses basic plus dearness allowance; this app does not track
  dearness allowance separately, so basic salary stands in for it.

## Deployment

`render.yaml` deploys the API to Render from `api/Dockerfile` (build context is the
repo root), with every secret set to `sync: false` so it comes from Render's secret
manager. The frontend deploys to Vercel from `web/`, with `API_PROXY_TARGET`
pointed at the Render URL — server-side only, so it never reaches the browser
bundle. (This used to be `NEXT_PUBLIC_API_BASE`, which the browser also read as
its own fetch base URL: the browser ended up calling the Render API directly,
cross-site, and the session cookie — `sameSite: "lax"` — was silently dropped
on every request after login. If you deployed before this fix, rename the
Vercel env var from `NEXT_PUBLIC_API_BASE` to `API_PROXY_TARGET` and redeploy.)
MongoDB Atlas and Upstash Redis (TCP mode, not the REST API, since BullMQ needs
blocking commands) back it.

Build the API image locally with:

```bash
docker build -f api/Dockerfile -t finance-tracker-api .
```
