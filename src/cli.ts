#!/usr/bin/env node
/** Standalone CLI for the bookkeeping ledger (independent of dsh). */

import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { budgetMessages } from './budget.js'
import { currentMonth } from './dateutil.js'
import {
  formatBudgetStatus,
  formatBudgets,
  formatCategories,
  formatCategory,
  formatDaily,
  formatEntryLine,
  formatList,
  formatMonthly,
  formatRules,
  formatTrend,
} from './format.js'
import { Ledger } from './ledger.js'
import { formatCents, normalizeCurrency } from './money.js'
import { EXPORTS_DIR, resolveDataDir } from './paths.js'
import type { ReportKind } from './report.js'
import { BookkeepingStore } from './store.js'
import { LedgerError } from './types.js'

const require = createRequire(import.meta.url)
const VERSION: string = require('../../package.json').version

export interface CliIo {
  out: (text: string) => void
  err: (text: string) => void
  /** Override the data directory (default: ~/.dsh-bookkeeping or DSH_BOOKKEEPING_DATA_DIR). */
  dataDir?: string
  /** Clock for relative dates (defaults to real time). */
  now?: () => Date
  /** Default currency (default CNY). */
  defaultCurrency?: string
}

const USAGE = `dsh-bookkeeping v${VERSION} — a local bookkeeping ledger

Usage: dsh-bookkeeping <command> [options]

Commands:
  add <amount> [remark...]    Record an entry, e.g. "add 35 午饭" or "add ¥500 工资 --type income"
  list                        List entries (--month --category --type --tag --limit)
  categorize <text...>        Predict the category of some text
  categories                  List known categories
  report [kind]               daily | monthly | category | trend (default: monthly)
  export [csv|html]           Export entries to a file under --out (default: csv)
  budget <set|list|check>     Monthly budgets, e.g. "budget set 5000 --category 餐饮"
  rules <add|list|remove>     Custom keyword -> category rules
  remove <id>                 Delete an entry by id

Options:
  --data-dir <path>       Data directory (default: ~/.dsh-bookkeeping)
  --month <YYYY-MM>       Filter by month
  --start <YYYY-MM-DD|YYYY-MM>  Inclusive start bound
  --end <YYYY-MM-DD|YYYY-MM>    Inclusive end bound
  --category <name>       Filter by category
  --type <expense|income> Filter by type
  --tag <tag>             Filter by tag
  --date <date>           Entry date for "add" (natural language accepted)
  --currency <ISO>        Currency for "add"
  --limit <n>             Maximum entries for "list"
  --months <n>            Trend window for "report trend"
  --out <dir>             Output directory for "export"
  -h, --help              Show this help
  -v, --version           Show version

Tip: pass values starting with "-" after --, e.g. "add -- -5" (note that
negative amounts are rejected by the ledger itself).`

class UsageError extends Error {}

const REPORT_KINDS = new Set(['daily', 'monthly', 'category', 'trend'])

/** Parse an integer flag; zero, negatives and non-integers are a usage error. */
function intFlag(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`invalid number: "${value}"`)
  return n
}

/** Run the CLI. Returns the process exit code (0 ok, 1 domain error, 2 usage error). */
export function runCli(argv: string[], io: CliIo): number {
  let store: BookkeepingStore | null = null
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        'data-dir': { type: 'string' },
        category: { type: 'string' },
        type: { type: 'string' },
        date: { type: 'string' },
        currency: { type: 'string' },
        tag: { type: 'string' },
        month: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        limit: { type: 'string' },
        months: { type: 'string' },
        out: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    })

    if (values.version) {
      io.out(VERSION)
      return 0
    }
    if (values.help) {
      io.out(USAGE)
      return 0
    }

    const dataDir = resolveDataDir(values['data-dir'] ?? io.dataDir)
    store = new BookkeepingStore(dataDir)
    const ledger = new Ledger({ store, now: io.now, defaultCurrency: io.defaultCurrency })
    const currency = normalizeCurrency(io.defaultCurrency) ?? 'CNY'
    const now = io.now ? io.now() : new Date()

    const [command, ...rest] = positionals
    if (!command) {
      io.out(USAGE)
      return 0
    }

    switch (command) {
      case 'add': {
        if (rest.length === 0) throw new UsageError('add requires an amount, e.g. "add 35 午饭"')
        const amount = rest[0]
        const remark = rest.slice(1).join(' ')
        const { entry, autoCategory, warnings } = ledger.add({
          amountText: amount,
          remark: remark || undefined,
          category: values.category,
          type: values.type as 'expense' | 'income' | undefined,
          currency: values.currency,
          date: values.date,
          tags: values.tag !== undefined ? [values.tag] : undefined,
        })
        const lines = [
          formatEntryLine(entry, { withId: true }),
          autoCategory ? `Category auto-detected: ${entry.category}` : '',
          ...warnings,
        ]
        io.out(lines.filter(Boolean).join('\n'))
        return 0
      }
      case 'list': {
        const { entries, totals } = ledger.list({
          month: values.month,
          start: values.start,
          end: values.end,
          category: values.category,
          type: values.type as 'expense' | 'income' | undefined,
          tag: values.tag,
          limit: intFlag(values.limit),
        })
        io.out(formatList(entries, totals, currency))
        return 0
      }
      case 'categorize': {
        if (rest.length === 0) throw new UsageError('categorize requires text, e.g. "categorize 打车去机场"')
        const text = rest.join(' ')
        const result = ledger.categorize(text)
        io.out(result.matched
          ? `"${text}" -> ${result.category} (matched keyword "${result.keyword}")`
          : `"${text}" -> ${result.category} (no rule matched)`)
        return 0
      }
      case 'categories': {
        const { builtin, rules } = ledger.categories()
        io.out(formatCategories(builtin, rules))
        return 0
      }
      case 'report': {
        const kind = rest[0] ?? 'monthly'
        if (!REPORT_KINDS.has(kind)) throw new UsageError(`unknown report kind: "${kind}" (expected daily, monthly, category or trend)`)
        const result = ledger.report(kind as ReportKind, {
          month: values.month,
          start: values.start,
          end: values.end,
          category: values.category,
          type: values.type as 'expense' | 'income' | 'all' | undefined,
          months: intFlag(values.months),
        })
        const rows = result.rows as never
        const text = result.kind === 'daily'
          ? formatDaily(rows, currency)
          : result.kind === 'monthly'
            ? formatMonthly(rows, currency)
            : result.kind === 'category'
              ? formatCategory(rows, currency)
              : formatTrend(rows, currency)
        io.out(text)
        return 0
      }
      case 'export': {
        const format = rest[0] ?? 'csv'
        if (format !== 'csv' && format !== 'html') throw new UsageError(`unknown export format: "${format}" (expected csv or html)`)
        const outDir = values.out ?? join(dataDir, EXPORTS_DIR)
        const result = ledger.exportEntries({
          month: values.month,
          start: values.start,
          end: values.end,
          category: values.category,
          type: values.type as 'expense' | 'income' | undefined,
          tag: values.tag,
        }, format as 'csv' | 'html', outDir)
        io.out(`Exported ${result.count} entry/entries to ${result.path}`)
        return 0
      }
      case 'budget': {
        const action = rest[0]
        if (action === 'set') {
          const amount = rest[1]
          if (amount === undefined) throw new UsageError('budget set requires an amount, e.g. "budget set 5000"')
          const { row, removed } = ledger.setBudget({
            month: values.month,
            category: values.category,
            amountText: amount,
          })
          const scope = `${values.month ?? ''} ${values.category ?? '(overall)'}`.trim()
          if (removed) {
            io.out(`Budget removed: ${scope}`)
          } else {
            io.out(`Budget set: ${scope} = ${formatCents(row!.limitCents, currency)}`)
          }
          return 0
        }
        if (action === 'list') {
          io.out(formatBudgets(ledger.budgets(values.month), currency))
          return 0
        }
        if (action === 'check') {
          const month = values.month ?? currentMonth(now)
          const statuses = ledger.budgetStatus(month, values.category ?? '*')
          const messages = budgetMessages(statuses, currency)
          io.out(messages.length > 0 ? messages.join('\n') : formatBudgetStatus(statuses, currency))
          return 0
        }
        throw new UsageError('budget requires an action: set | list | check')
      }
      case 'rules': {
        const action = rest[0]
        if (action === 'add') {
          const keyword = rest[1]
          const category = rest[2]
          if (keyword === undefined || category === undefined) {
            throw new UsageError('rules add requires a keyword and a category, e.g. "rules add 咖啡豆 购物"')
          }
          const rule = ledger.addRule(keyword, category)
          io.out(`Rule added: "${rule.keyword}" -> ${rule.category}`)
          return 0
        }
        if (action === 'list') {
          io.out(formatRules(ledger.rulesList()))
          return 0
        }
        if (action === 'remove') {
          const keyword = rest[1]
          if (keyword === undefined) throw new UsageError('rules remove requires a keyword')
          const removed = ledger.removeRule(keyword)
          io.out(removed ? `Rule removed: "${keyword}"` : `No rule found for keyword "${keyword}"`)
          return 0
        }
        throw new UsageError('rules requires an action: add | list | remove')
      }
      case 'remove': {
        const raw = rest[0]
        const id = Number(raw)
        if (raw === undefined || !Number.isSafeInteger(id) || id <= 0) {
          throw new UsageError('remove requires a positive entry id, e.g. "remove 12"')
        }
        const removed = ledger.remove(id)
        io.out(removed ? `Entry #${id} removed` : `Entry #${id} not found`)
        return 0
      }
      default:
        throw new UsageError(`Unknown command: "${command}"`)
    }
  } catch (error) {
    const parseError = error instanceof TypeError
      && typeof (error as { code?: string }).code === 'string'
      && String((error as { code?: string }).code).startsWith('ERR_PARSE_ARGS')
    if (error instanceof UsageError || parseError) {
      io.err(`${error.message}\n\n${USAGE}`)
      return 2
    }
    if (error instanceof LedgerError) {
      io.err(error.message)
      return 1
    }
    io.err(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    store?.close()
  }
}

// Entry point when executed directly (node dist/src/cli.js …) or via the bin.
// Compare REAL paths: when the CLI is invoked through a symlink or junction
// (npm link, pnpm .bin shims, package managers), argv[1] differs from the
// module URL even though both name the same file.
const isMain = process.argv[1] !== undefined && (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) {
  const code = runCli(process.argv.slice(2), {
    out: (text: string) => process.stdout.write(`${text}\n`),
    err: (text: string) => process.stderr.write(`${text}\n`),
  })
  process.exit(code)
}

export { VERSION }