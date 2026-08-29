# Lint & Format Tooling Setup Report

Branch: `lint-setup` (worktree: `finance-tracker-lint-setup`, forked from `finance-tracker-core` at Task 19)

## Files added / modified

**New files:**
- `.prettierrc` — shared Prettier config for the whole monorepo
- `.prettierignore` — node_modules, dist, .next, coverage, lockfile, log files, AppleDouble `._*` files
- `eslint.config.mjs` — single shared flat-config ESLint setup covering `api/`, `web/`, and `shared/`

**Modified files:**
- `package.json` (root) — added `lint`, `format`, `format:check` scripts; added devDependencies (see below)
- `pnpm-lock.yaml` — updated by `pnpm add`
- `pnpm-workspace.yaml` — see "Side-fix" note below

**Root devDependencies added:**
```
@eslint/eslintrc     ^3.3.6
@eslint/js           ^8.57.0   (pinned to match eslint 8.57.1 — the npm-latest @eslint/js is v10.x,
                                 which declares a peer on eslint ^10 and would create an unmet-peer warning)
eslint               8.57.1    (pinned — see "Why ESLint 8, not 9" below)
eslint-config-next   14.2.5    (matches the installed next version in web/package.json)
eslint-config-prettier ^10.1.8
globals              ^17.11.0
prettier             ^3.9.6
typescript-eslint    ^8.68.0
```

No new dependencies were added to `api/package.json` or `web/package.json` — ESLint and Prettier
are root-level, shared across the whole pnpm workspace, and `eslint.config.mjs` scopes rules to
each package via file globs (`api/src/**/*.ts`, `web/**/*.ts`, `web/**/*.tsx`) rather than
duplicating config per package.

## Why ESLint 8, not 9

The task asked for flat config (`eslint.config.js`/`.mjs`), which is supported since ESLint 8.57
(auto-detected without an env var, confirmed empirically here) and is the default in ESLint 9.
`eslint-config-next@14.2.5` (matching the Next 14.2.5 already in `web/package.json`) declares a
peer dependency of `eslint": "^7.23.0 || ^8.0.0"` — it does not support ESLint 9. Using ESLint 9
would have meant either fighting a peer-dependency conflict or falling back to a hand-rolled
React/TS ruleset for `web/`. Pinning to ESLint `8.57.1` (the last 8.x release) gets flat config
*and* a clean, conflict-free composition of Next's own config, confirmed by `pnpm peers check`
reporting no issues. This was verified as the pragmatic choice under the task's own guidance
("Next.js's own ESLint config ... if it composes cleanly with a flat config setup").

`eslint-config-next` is legacy-format, so it's loaded into the flat config via `FlatCompat`
(`@eslint/eslintrc`) and its resulting config objects are re-scoped to `web/**/*.ts(x)` /
`web/**/*.js(x)` only, so it never applies to `api/` or `shared/`.

## Prettier config choices (matched to existing codebase style)

Confirmed by reading `api/src/config/env.ts`, `api/src/modules/accounts/accounts.routes.ts`,
`web/app/layout.tsx`, and a `grep` across `api/src` (51 files with double-quoted strings vs. 19
with single-quote occurrences, the latter mostly apostrophes inside string literals):

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "printWidth": 100,
  "trailingComma": "es5",
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- `semi: true`, `singleQuote: false`, `tabWidth: 2` — directly match every sampled file.
- `trailingComma: "es5"` — matches the existing pattern of trailing commas in multi-line object/array
  literals (e.g. `accounts.routes.ts`'s `createSchema`) but *no* trailing comma after the last
  argument in multi-line function calls (e.g. `Account.findOneAndUpdate(..., { new: true }\n)`),
  which is exactly Prettier's `es5` behavior (not `all`, Prettier 3's default).
- `printWidth: 100` — the codebase isn't Prettier-formatted yet so there's no ground truth here;
  100 is a reasonable middle ground given several existing lines already run 110-124 chars
  (`categories.service.ts`, `recurring.routes.ts`, `investments.routes.ts`). Flagged as a judgment
  call, not a measured convention — easy to change before the reformat follow-up if the team wants 80.

## ESLint rule design

- Base: `@eslint/js` recommended + `typescript-eslint` recommended (non-type-checked — deliberately
  not `recommendedTypeChecked`/`strictTypeChecked`, to avoid requiring `parserOptions.project`
  wiring across three tsconfigs and to avoid a much larger, noisier first-run finding set).
- `eslint-config-prettier` applied last, disabling all ESLint stylistic rules that could conflict
  with Prettier output.
- `api/src/**/*.ts` gets `globals.node`; `web/**/*.ts(x)` gets `globals.browser`.
- **`(req as any).userId` / `(err as any).status` pattern**: `@typescript-eslint/no-explicit-any`
  is turned off, but *only* for the specific files where this established, already-reviewed pattern
  lives:
  - `api/src/**/*.routes.ts` (all route files — this is where nearly all 16 occurrences are)
  - `api/src/modules/auth/auth.middleware.ts`
  - `api/src/modules/auth/auth.service.ts`
  - `api/src/lib/errorHandler.ts`

  This is a targeted, file-scoped allowance, not a blanket `no-explicit-any: off` for all of
  `api/`. Confirmed by running `pnpm lint`: zero findings in any `*.routes.ts` file, in
  `auth.middleware.ts`, `auth.service.ts`, or `errorHandler.ts`. `no-explicit-any` is still an
  **error** everywhere else in `api/` — it correctly still flags `categories.service.ts` (a
  different, unrelated `any` usage: `cat as any` when building a category tree, not the req/err
  pattern) and several `any` usages in test files.
- `@typescript-eslint/no-unused-vars` is set to `warn` (not the recommended default `error`) with
  `argsIgnorePattern: "^_"` / `varsIgnorePattern: "^_"`, a common convention for intentionally
  unused args/vars. Kept as a warning rather than off, since it's a legitimate low-noise signal
  worth surfacing without blocking CI.

## Verification

### `pnpm lint` (real output, current unformatted codebase)

```
$ eslint .
Pages directory cannot be found at .../pages or .../src/pages. If using a custom path, please
configure with the `no-html-link-for-pages` rule in your eslint config file.

/api/src/modules/categories/categories.service.ts
  22:37  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  24:27  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  27:25  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/api/src/modules/transactions/duplicate-detection.ts
  9:29  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/api/test/modules/auth.middleware.test.ts
  10:11  error  A `require()` style import is forbidden   @typescript-eslint/no-require-imports
  12:32  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/api/test/modules/auth.test.ts
   1:36  warning  'beforeEach' is defined but never used. Allowed unused vars must match /^_/u
  25:13  warning  'hashOtp' is assigned a value but never used. Allowed unused vars must match /^_/u
   (both @typescript-eslint/no-unused-vars)

/api/test/modules/categories.test.ts
  147:38  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/api/test/modules/csv-import.test.ts
   30:57  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   31:56  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  115:47  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  120:57  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

/api/test/modules/recurring.test.ts
  151:34  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

✖ 14 problems (12 errors, 2 warnings)
```

Exit code 1 (as expected — real findings exist). ESLint scanned 89 files total (79 in `api/`,
8 in `web/`, plus root config files) — confirmed via `eslint . --format json` file count; `web/`
came back with **zero** findings across all 6 real source files
(`layout.tsx`, `page.tsx`, `login/page.tsx`, `lib/api-client.ts`, `next-env.d.ts`,
`tailwind.config.ts`), plus its config files (`next.config.mjs`, `postcss.config.mjs`).

**Note on the "Pages directory cannot be found" line**: this is an informational message printed
by `eslint-config-next`'s `no-html-link-for-pages` rule detection (it looks for a legacy Pages
Router directory that doesn't exist in this App Router project) — not a lint error, and expected
for an App Router-only Next project.

**Summary of finding types (for the follow-up cleanup task):**
- 10× `@typescript-eslint/no-explicit-any` (error) — genuine, pre-existing `any` usage *outside*
  the reviewed req/err pattern: 3 in `categories.service.ts` (building a category tree), 1 in
  `duplicate-detection.ts`, 6 across test files (mostly casting mocked Mongoose documents/mocks).
  These are real code-quality findings, not formatting noise.
- 1× `@typescript-eslint/no-require-imports` (error) — a single `require()` in
  `api/test/modules/auth.middleware.test.ts` instead of an ES import.
- 2× `@typescript-eslint/no-unused-vars` (warning) — unused `beforeEach` import and unused
  `hashOtp` in `api/test/modules/auth.test.ts`.

Total: **14 findings across the entire ~89-file scanned codebase**, all in `api/test/` or a
handful of `api/src/` files — this is a small, easily triageable list, not an overwhelming wall of
noise. None of it will block or complicate the planned formatting-only follow-up pass.

### `pnpm format:check` (real output)

```
$ prettier --check .
Checking formatting...
[warn] api/src/jobs/queue.ts
[warn] api/src/jobs/workers/priceRefresh.worker.ts
[warn] api/src/lib/resend.ts
[warn] api/src/models/Category.ts
[warn] api/src/modules/accounts/accounts.routes.ts
[warn] api/src/modules/auth/auth.routes.ts
[warn] api/src/modules/categories/categories.service.ts
[warn] api/src/modules/categorization/categorization.engine.ts
[warn] api/src/modules/categorization/categorization.routes.ts
[warn] api/src/modules/dashboard/dashboard.service.ts
[warn] api/src/modules/dashboard/guilt-free.service.ts
[warn] api/src/modules/investments/csv-import/zerodha.parser.ts
[warn] api/src/modules/investments/holdings-fifo.ts
[warn] api/src/modules/investments/holdings.service.ts
[warn] api/src/modules/investments/investments.routes.ts
[warn] api/src/modules/market-data/price-cache.service.ts
[warn] api/src/modules/recurring/recurring.routes.ts
[warn] api/src/modules/recurring/recurring.service.ts
[warn] api/src/modules/transactions/csv-import/csv-import.routes.ts
[warn] api/src/modules/transactions/csv-import/parsers/genericBank.parser.ts
[warn] api/src/modules/transactions/pending.routes.ts
[warn] api/src/modules/transactions/transactions.routes.ts
[warn] api/test/lib/withRetry.test.ts
[warn] api/test/modules/accounts.test.ts
[warn] api/test/modules/auth.test.ts
[warn] api/test/modules/categories.test.ts
[warn] api/test/modules/categorization.test.ts
[warn] api/test/modules/csv-import.test.ts
[warn] api/test/modules/dashboard.test.ts
[warn] api/test/modules/duplicate-detection.test.ts
[warn] api/test/modules/export.test.ts
[warn] api/test/modules/goals.test.ts
[warn] api/test/modules/investments.test.ts
[warn] api/test/modules/market-data-clients.test.ts
[warn] api/test/modules/market-data.test.ts
[warn] api/test/modules/pending-transactions.test.ts
[warn] api/test/modules/recurring.test.ts
[warn] api/test/modules/transactions.test.ts
[warn] docs/superpowers/plans/2026-08-28-finance-tracker-core-plan.md
[warn] docs/superpowers/specs/2026-08-28-finance-tracker-core-design.md
[warn] docs/superpowers/specs/2026-08-28-finance-tracker-tax-module-design.md
Code style issues found in 41 files. Run Prettier with --write to fix.
```

Exit code 1 (expected — nothing has been formatted yet). 41 files flagged, entirely within
`api/` and 3 markdown files under `docs/superpowers/`. **No files were reformatted** — this
command is `--check` only (non-mutating), no `--write`/`--fix` was run against the codebase.
`web/` and `shared/` reported no formatting issues (their few existing files already happen to
match the chosen style).

New config files (`.prettierrc`, `eslint.config.mjs`, `package.json`) all pass
`prettier --check` themselves.

### Smoke test

Created a throwaway file `api/src/__lint_smoke_test__/smoke.ts` with an obviously unused
variable, ran `eslint` against it directly, confirmed it was flagged
(`'unusedVar' is assigned a value but never used ... @typescript-eslint/no-unused-vars`), then
deleted the file and its directory. Not committed.

### `tsc --noEmit`

```
$ cd api && npx tsc --noEmit
(no output, exit 0)

$ cd web && npx tsc --noEmit
(no output, exit 0)
```

Both pass cleanly, before and after the lint/format tooling was added — confirming the new
config doesn't affect type-checking at all (ESLint and `tsc` are independent tools here; no
`tsconfig.json` files were modified).

Also re-verified using the exact commands named in the task:
```
$ pnpm --filter api exec tsc --noEmit   # exit 0
$ pnpm --filter web exec tsc --noEmit   # exit 0
```

## Side-fix: `pnpm --filter <pkg> exec` / `pnpm run <script>` was broken in this sandbox

As flagged as a known possibility in the task brief, `pnpm --filter api exec tsc --noEmit` (and,
it turned out, **any** `pnpm run <script>` invocation, including `pnpm lint`/`pnpm format:check`
themselves) failed with `ERR_PNPM_IGNORED_BUILDS` before any of this task's dependencies were
even involved. Root cause: `pnpm-workspace.yaml`'s pre-existing `allowBuilds` section contained
placeholder text instead of real booleans:

```yaml
allowBuilds:
  esbuild: set this to true or false
  mongodb-memory-server: set this to true or false
  msgpackr-extract: set this to true or false
```

This left `esbuild`, `mongodb-memory-server`, and `msgpackr-extract`'s install scripts in a
permanently-unresolved "needs approval" state, which pnpm re-checks (and fails on, non-
interactively) before running *any* workspace script. This wasn't something `npx tsc` from inside
a package directory could route around for `pnpm lint`/`pnpm format:check` specifically, since
those commands are pnpm root scripts by design.

Fixed by running `pnpm approve-builds --all`, which pnpm itself rewrote into real boolean values
(and added `unrs-resolver`, a new transitive dependency pulled in by
`eslint-plugin-import`/`eslint-config-next` that also needed approval):

```yaml
allowBuilds:
  esbuild: true
  mongodb-memory-server: true
  msgpackr-extract: true
  unrs-resolver: true
```

This is a minimal, mechanical fix to a pre-existing broken placeholder (not a reformat, not a
logic change) and was necessary for `pnpm lint` / `pnpm format:check` / `pnpm --filter ... exec`
to run at all, for anyone, in this environment — not just for verifying this task.

## Self-review checklist

- [x] `.prettierrc` style choices verified against `api/src/config/env.ts`,
      `api/src/modules/accounts/accounts.routes.ts`, and `web/app/layout.tsx` — double quotes,
      semicolons, 2-space indent, es5 trailing commas all confirmed as prevailing style.
- [x] `pnpm lint` produces a **small, triageable** finding set (14 total: 12 errors, 2 warnings,
      across ~89 scanned files) — not an overwhelming wall of noise. Breakdown by type given above
      for the follow-up cleanup task.
- [x] The `(req as any).userId` pattern is confirmed **not** flagged: zero ESLint findings in any
      `api/src/**/*.routes.ts` file, `auth.middleware.ts`, `auth.service.ts`, or
      `errorHandler.ts`. The rule is scoped off only for those specific files, not blanket-disabled
      for `api/`.
- [x] Both `tsc --noEmit` checks (api, web) pass, confirmed via both `npx tsc --noEmit` from
      inside each package directory and `pnpm --filter <pkg> exec tsc --noEmit` from the root.
- [x] No existing source files were reformatted or had their logic touched. Only new config files
      plus the necessary `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` tooling changes.
- [x] Nothing under `docs/` or `.superpowers/` was modified (3 markdown files under `docs/` were
      only *reported* as unformatted by the non-mutating `format:check`, never written to).
