# dsh-bookkeeping

**English · [简体中文](README.zh.md)**

A conversational bookkeeping plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Record expenses and income by chatting — "记一笔 午饭 35" — then query, report, export, and budget against a local SQLite ledger.

The plugin is a self-contained **dsh bundle**: an npm package whose `package.json` declares the `dsh.bundle` manifest, ships a `cordis.patch.yml` layer, and exports a standard plugin entry (`name` / `inject` / `Config` / `apply`). It works both as model-callable tools inside dsh and as a standalone CLI.

## Features

- **Conversational bookkeeping** — the model records entries through `bookkeeping_add`; amounts are validated strictly, dates are normalized from natural language, categories are auto-detected.
- **SQLite ledger** — local persistence with amount / category / tags / date / currency fields (amounts stored as exact integer minor units).
- **Category system** — built-in categories (餐饮 / 交通 / 购物 / 居住 / 娱乐 / 医疗 / 学习 / 收入 / 其他), keyword auto-classification, and custom keyword→category rules.
- **Reports** — daily / monthly / category summaries and monthly trends, filterable by month, range, category, type and tag.
- **Exports** — CSV (RFC 4180 quoting) and self-contained HTML reports.
- **Budgets** — optional monthly budgets (overall or per category) with near-limit (≥80%) and over-budget warnings returned right when an entry is recorded.
- **Dual entry** — nine model-callable tools (`ctx.tools`) plus a standalone CLI with identical behavior.

## Requirements

- Node.js `^22.19.0 || >=24.0.0` (same range as dsh itself)
- A running dsh installation (`npx @deepseek-ai/dsh`), with `pnpm` on `PATH` for plugin installation

## Install into dsh

From the repository root, build the package first:

```sh
npm install
npm run build
npm pack          # optional: produces dsh-bookkeeping-1.0.0.tgz
```

Install the bundle into a dsh profile (any pnpm spec works: directory, tarball, `github:...`, or an npm package name):

```sh
dsh plugin --profile bookkeeping add <path/to/dsh-bookkeeping>
# or: dsh plugin --profile bookkeeping add ./dsh-bookkeeping-1.0.0.tgz
```

Verify the layer is composed, then boot:

```sh
dsh --profile bookkeeping --dump-config   # expect a "# == dsh-bookkeeping" layer
dsh --profile bookkeeping
```

> pnpm may print `Ignored build scripts: better-sqlite3@13.0.3` during install.
> That warning is benign: better-sqlite3 v13 ships prebuilt binaries inside the
> package, so no build step is required.

Once running, the model can use the tools directly in chat:

```
用户: 记一笔 午饭 35
用户: 昨天打车花了 28
用户: 花了多少钱在餐饮上？
用户: 这个月一共花了多少？
用户: 给我看下最近 10 条记录
用户: 导出 csv
用户: 设置本月预算 5000
```

## Configuration

Plugin configuration is declared with a Schemastery schema (`export const Config`) and supplied through the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: bookkeeping
      name: dsh-bookkeeping
      config:
        dataDir: /var/data/bookkeeping   # optional, default ~/.dsh-bookkeeping
        currency: CNY                    # optional, default CNY
        maxAmount: 1000000000000         # optional, max single amount in units
```

| Key        | Type   | Default               | Meaning                                                      |
| ---------- | ------ | --------------------- | ------------------------------------------------------------ |
| `dataDir`  | string | `~/.dsh-bookkeeping`  | Where `ledger.db` and the `exports/` directory live. Also honored via the `DSH_BOOKKEEPING_DATA_DIR` environment variable (explicit config wins). |
| `currency` | string | `CNY`                 | Default currency when an amount carries no symbol.           |
| `maxAmount`| number | `1_000_000_000_000`   | Upper bound for a single amount, in units.                   |

## Tools

All tools return `{ summary, data }`; `summary` is model-facing text, `data` is structured JSON.

| Tool | Purpose |
| ---- | ------- |
| `bookkeeping_add` | Record one entry. `amount` required; `category` auto-detected when omitted; `type` (expense/income), `currency`, `remark`, `tags`, `date` (natural language) optional. |
| `bookkeeping_list` | List entries, newest first, with filters `month` / `start` / `end` / `category` / `type` / `tag` / `limit`. |
| `bookkeeping_categorize` | Predict the category of free text using built-in keywords and custom rules. |
| `bookkeeping_categories` | List all known categories (built-in plus custom-rule categories) with their kind. |
| `bookkeeping_report` | Aggregations: `daily`, `monthly`, `category`, `trend` (+ `months`). Filters: `month` / `start` / `end` / `category` / `type`. |
| `bookkeeping_export` | Write a CSV or HTML file under `<dataDir>/exports/`; exports the full matching set and returns the absolute file path. |
| `bookkeeping_budget` | `set` / `list` / `check` monthly budgets. `set` with amount `"0"` removes the budget. |
| `bookkeeping_rules` | Manage custom keyword→category rules: `add` / `list` / `remove`. |
| `bookkeeping_remove` | Delete an entry by id (shown as `#12` in listings). |

## CLI

The same ledger is available as a standalone CLI (no dsh required):

```sh
node dist/src/cli.js add 35 午饭                 # record
node dist/src/cli.js add "¥500" 工资 --type income --date 昨天
node dist/src/cli.js list --month 2026-08        # list
node dist/src/cli.js report category --month 2026-08
node dist/src/cli.js report trend --months 6
node dist/src/cli.js export csv --out ./out
node dist/src/cli.js budget set 5000             # overall monthly budget
node dist/src/cli.js budget set 1500 --category 餐饮
node dist/src/cli.js rules add 咖啡豆 购物
node dist/src/cli.js remove 12
```

Run `node dist/src/cli.js --help` for the full reference. Exit codes: `0` ok, `1` domain error (invalid amount/date/…), `2` usage error. Data lives in `~/.dsh-bookkeeping` (override with `--data-dir` or `DSH_BOOKKEEPING_DATA_DIR`).

## Data storage

A single SQLite database (`ledger.db`) in the data directory, WAL mode. Tables:

- `entries` — `id`, `amount_cents` (integer minor units, always > 0), `currency`, `type` (`expense`/`income`), `category`, `remark`, `tags` (JSON array), `date` (`YYYY-MM-DD`), `created_at`
- `category_rules` — custom `keyword` → `category` rules (checked before built-in keywords)
- `budgets` — `(month, category)` limits; category `'*'` is the overall budget
- `meta` — reserved for schema metadata

Exports are written to `<dataDir>/exports/ledger-<timestamp>.csv|html`.

## Amounts & dates

**Amounts.** Text like `35`, `35.5`, `¥35`, `35元`, `$35.99`, `1,234.56`. Symbols select the currency (`¥`/`￥`→CNY, `$`→USD, `€`→EUR, `£`→GBP, `₩`→KRW; suffixes `元`/`块`→CNY, `円`→JPY). An explicit `currency` argument overrides the default but must not conflict with a symbol. Rejected: zero, negatives, non-numeric text, malformed thousands separators, more decimal digits than the currency supports (2 for CNY/USD/…, 0 for JPY/KRW), amounts above `maxAmount`.

**Dates.** `YYYY-MM-DD`, `2026/8/17`, `2026.8.17`, `2026年8月17日`, `8/17`, `8月17日`, `3月`; relative words `今天/今日/昨天/昨日/前天/明天/明日/后天` and `today/yesterday/tomorrow`; weekdays `周X`/`星期X`/`礼拜X` (mapped into the current Monday-based week), `上周X`, `下周X`, bare `上周`/`下周`; offsets `N天前/N天后`, `N周前/后`, `N个月前/后`; months `上个月/本月/这个月/下个月` (day-of-month clamped to the target month's length). Unparseable dates are rejected with the supported formats listed. Year range: 1900–2100.

## Categories

Built-in categories with keyword auto-classification: 餐饮, 交通, 购物, 居住, 娱乐, 医疗, 学习, 收入, 其他 (fallback). Matching is case-insensitive substring matching; the **longest** matching keyword wins, ties prefer custom rules, and anything unmatched falls to 其他. Custom rules persist in the database, e.g. `rules add 咖啡豆 购物` makes any remark containing "咖啡豆" classify as 购物.

## Reports & budgets

- `daily` — per-day expense/income totals; `monthly` — per-month totals with net (income − expense); `category` — per-category totals with share, sorted by amount; `trend` — monthly totals for the last N months (zero-filled).
- Filters accept `YYYY-MM` or `YYYY-MM-DD` bounds (month bounds expand to the month's first/last day). `type` defaults to both (`all`); pass `expense`/`income` to narrow.
- Budgets are monthly (`YYYY-MM`), overall or per category. When recording an expense, matching budgets are checked immediately: ≥80% produces a near-limit notice, ≥100% an over-budget warning. Income never consumes a budget. `budget set … 0` removes a budget. An overall `budget check` reports every budget of the month (overall plus each category).

## FAQ

- **Where is my ledger stored?** A SQLite database `ledger.db` under the
  configured `dataDir` (default `~/.dsh-bookkeeping`), with exports in
  `<dataDir>/exports/`. Override via `DSH_BOOKKEEPING_DATA_DIR` or the
  `--data-dir` CLI flag (an explicit config value wins).
- **Can I store amounts in other currencies?** Yes — symbols and suffixes
  select the currency (`¥`→CNY, `$`→USD, `€`→EUR, `£`→GBP, `₩`→KRW, `円`→JPY,
  `元`/`块`→CNY). Set `currency` to change the default. There is no currency
  conversion; aggregates assume a single currency.
- **The model keeps booking the wrong category.** Add or adjust a custom rule:
  `bookkeeping_rules add 关键词 分类` (or `rules add 咖啡豆 购物` in the CLI).
  Custom rules are checked before built-in keywords.
- **A budget warning did not fire.** Budgets are monthly and denominated in the
  ledger's default currency; income never consumes a budget. Confirm the
  `YYYY-MM` month string and that the entry's default currency matches.

## Development

```sh
npm install
npm run build     # tsc -> dist/
npm test          # tsc + node --test
```

Layout: `src/money.ts` (amount parsing/formatting), `src/dateutil.ts` (natural-language dates), `src/categories.ts` (built-ins + autoclassify), `src/store.ts` (SQLite), `src/ledger.ts` (domain service), `src/report.ts` / `src/budget.ts` / `src/export.ts` (aggregation, budgets, exports), `src/format.ts` (shared text), `src/tools.ts` (dsh tools), `src/cli.ts` (CLI), `src/index.ts` (bundle entry). Tests mirror this structure under `test/`.

## Bundle layout

```
package.json        dsh: { bundle: { patch: "./cordis.patch.yml" } }, type: module, exports, bin
cordis.patch.yml    layer that inserts the plugin row (id: bookkeeping, name: dsh-bookkeeping)
dist/src/index.js   entry: export const name / inject / Config / apply(ctx, config)
dist/src/cli.js     standalone CLI (bin: dsh-bookkeeping)
```

## Limitations

- No currency conversion — each entry keeps its own currency; aggregate sums assume a single currency (mixing currencies sums minor units numerically, and budgets sum the recorded units of expense entries in the default currency's display).
- `bookkeeping_list` totals cover the shown page only; use `bookkeeping_report` for full sums.
- `周X` always resolves inside the current Monday-based week (documented convention), including upcoming weekdays.
- Budgets are denominated in the ledger's default currency.
- The plugin stores data locally by design; it is not a multi-user service.

## License

[MIT](./LICENSE)
