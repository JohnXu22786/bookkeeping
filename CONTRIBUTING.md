# Contributing

Thanks for considering a contribution to `dsh-bookkeeping`.

## Setup

```bash
npm install
npm run build     # tsc -> dist/
npm test          # tsc + node --test
```

Requires Node `^22.19.0 || >=24.0.0`. `better-sqlite3` v13 ships prebuilt
binaries, so no native build step is needed.

## Project layout

- `src/money.ts` — amount parsing/formatting (exact integer minor units).
- `src/dateutil.ts` — natural-language date parsing and month helpers.
- `src/categories.ts` — built-in categories and keyword auto-classification.
- `src/store.ts` — SQLite persistence.
- `src/ledger.ts` — domain service.
- `src/report.ts`, `src/budget.ts`, `src/export.ts` — aggregation, budgets, exports.
- `src/format.ts` — shared text helpers.
- `src/tools.ts` — dsh model tools (`ctx.tools`).
- `src/cli.ts` — standalone CLI; `src/index.ts` — bundle entry.

Tests mirror the module layout under `test/`.

## Guidelines

- Add or extend a test under `test/` for any behavior change.
- Amount/date/report semantics must never depend on floating point —
  amounts are string-parsed into integer minor units.
- Keep the CLI and the dsh tools on the same domain service so behavior stays
  identical.
- Update `README.md` (English) and `README.zh.md` (Chinese) together when the
  user-visible surface changes, and add a CHANGELOG entry under `[Unreleased]`.
