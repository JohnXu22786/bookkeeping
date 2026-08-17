/** Domain service shared by the dsh tools and the CLI. */

import { budgetMessages, checkBudgets } from './budget.js'
import {
  BUILTIN_CATEGORIES,
  categorize,
  categoryKind,
  normalizeCategory,
  type CategoryInfo,
} from './categories.js'
import { currentMonth, formatDate, isValidDate, normalizeBound, parseDate, toMonth } from './dateutil.js'
import { DEFAULT_MAX_UNITS, normalizeCurrency, parseAmount } from './money.js'
import {
  categorySummary,
  dailySummary,
  monthlySummary,
  trend,
  type PeriodTotals,
  type ReportFilter,
  type ReportKind,
  type ReportResult,
} from './report.js'
import type { BookkeepingStore } from './store.js'
import {
  LedgerError,
  type BudgetRow,
  type CategoryRule,
  type Entry,
  type EntryFilter,
  type EntryInput,
  type EntryType,
} from './types.js'
import { exportEntries, type ExportResult } from './export.js'

const MAX_REMARK_LENGTH = 200
const MAX_TAG_LENGTH = 20
const MAX_TAGS = 10
const MAX_KEYWORD_LENGTH = 50
const MAX_REPORT_MONTHS = 24

export interface LedgerDeps {
  store: BookkeepingStore
  /** Currency used when an amount carries no symbol; default 'CNY'. */
  defaultCurrency?: string
  /** Maximum accepted amount in units; default 1e12. */
  maxUnits?: number
  /** Clock used for "today" and relative dates; defaults to real time. */
  now?: () => Date
}

export interface AddResult {
  entry: Entry
  /** Whether the category was auto-detected rather than given explicitly. */
  autoCategory: boolean
  /** Budget warnings raised by this entry (empty when all good). */
  warnings: string[]
}

export interface ListResult {
  entries: Entry[]
  totals: PeriodTotals
}

export interface SetBudgetResult {
  row: BudgetRow | null
  /** True when the budget was removed (amount "0"). */
  removed: boolean
}

export class Ledger {
  private readonly store: BookkeepingStore
  private readonly defaultCurrency: string
  private readonly maxUnits: number
  private readonly now: () => Date

  constructor(deps: LedgerDeps) {
    this.store = deps.store
    // Fail fast on an invalid configured currency instead of corrupting the ledger.
    this.defaultCurrency = normalizeCurrency(deps.defaultCurrency ?? 'CNY')!
    this.maxUnits = deps.maxUnits ?? DEFAULT_MAX_UNITS
    this.now = deps.now ?? (() => new Date())
  }

  private rules(): CategoryRule[] {
    return this.store.listRules()
  }

  add(input: EntryInput): AddResult {
    const now = this.now()
    // The configured default currency applies only when the amount carries no symbol.
    const parsed = parseAmount(input.amountText, {
      currency: input.currency,
      defaultCurrency: this.defaultCurrency,
      maxUnits: this.maxUnits,
    })

    const type = input.type ?? 'expense'
    if (type !== 'expense' && type !== 'income') {
      throw new LedgerError(`Invalid type: "${type}" (expected "expense" or "income")`)
    }

    let date: string | null
    if (input.date === undefined || input.date.trim() === '') {
      date = formatDate(now)
    } else {
      date = parseDate(input.date, now)
    }
    if (date === null) {
      throw new LedgerError(
        `Invalid date: cannot parse "${input.date}". Supported: YYYY-MM-DD, YYYY/M/D, YYYY.M.D, 2026年8月17日, 8/17, 8月17日, 3月, 今天/今日/昨天/昨日/前天/明天/明日/后天, today/yesterday/tomorrow, 周X/星期X/礼拜X, 上周X/下周X, 上周/下周, N天前/N天后, N周前/后, N个月前/后, 上个月/本月/这个月/下个月`,
      )
    }

    let category: string
    let autoCategory = false
    let effectiveType = type
    const rawCategory = input.category === undefined ? '' : input.category.trim()
    if (rawCategory) {
      category = normalizeCategory(rawCategory)
    } else {
      autoCategory = true
      const auto = categorize(`${input.remark ?? ''} ${(input.tags ?? []).join(' ')}`, this.rules())
      category = auto.category
      // An income-kind category (工资, 退款, …) implies an income entry when
      // the type was not stated explicitly.
      if (input.type === undefined && categoryKind(category) === 'income') {
        effectiveType = 'income'
      }
    }

    // Budget warnings use the pre-insert spend plus the to-be-recorded amount,
    // so the new entry is counted exactly once.
    const warnings = budgetMessages(
      checkBudgets(this.store, toMonth(date), category, parsed.cents, effectiveType),
      this.defaultCurrency,
    )

    const entry = this.store.addEntry({
      amountCents: parsed.cents,
      currency: parsed.currency,
      type: effectiveType,
      category,
      remark: sanitizeRemark(input.remark),
      tags: sanitizeTags(input.tags),
      date,
      createdAt: new Date().toISOString(),
    })
    return { entry, autoCategory, warnings }
  }

  list(filter: EntryFilter = {}): ListResult {
    const entries = this.store.listEntries(sanitizeFilter(filter))
    let expenseCents = 0
    let incomeCents = 0
    for (const e of entries) {
      if (e.type === 'expense') expenseCents += e.amountCents
      else incomeCents += e.amountCents
    }
    return { entries, totals: { expenseCents, incomeCents, count: entries.length } }
  }

  remove(id: number): boolean {
    return this.store.removeEntry(id)
  }

  categorize(text: string): { category: string; matched: boolean; keyword: string | null } {
    return categorize(text, this.rules())
  }

  categories(): { builtin: CategoryInfo[]; rules: CategoryRule[] } {
    return { builtin: [...BUILTIN_CATEGORIES], rules: this.rules() }
  }

  rulesList(): CategoryRule[] {
    return this.rules()
  }

  addRule(keyword: string, category: string): CategoryRule {
    const kw = sanitizeKeyword(keyword)
    const cat = normalizeCategory(category)
    return this.store.addRule(kw, cat)
  }

  removeRule(keyword: string): boolean {
    // Mirror addRule's canonicalization so removal is case-insensitive.
    const kw = keyword.trim().replace(/[\u0000-\u001f\u007f]/g, '').toLowerCase()
    if (!kw) throw new LedgerError('Invalid rule: keyword is empty')
    return this.store.removeRule(kw)
  }

  setBudget(input: { month?: string; category?: string; amountText: string }): SetBudgetResult {
    const month = input.month ?? currentMonth(this.now())
    validateMonth(month)
    const category = normalizeCategory(input.category ?? '*')
    const text = input.amountText.trim()
    if (text === '0') {
      this.store.removeBudget(month, category)
      return { row: null, removed: true }
    }
    // Budget amounts follow the ledger's default currency (denomination-free display).
    const parsed = parseAmount(text, { defaultCurrency: this.defaultCurrency, maxUnits: this.maxUnits })
    const row = this.store.setBudget(month, category, parsed.cents)
    return { row, removed: false }
  }

  budgets(month?: string): BudgetRow[] {
    if (month !== undefined) validateMonth(month)
    return this.store.listBudgets(month)
  }

  report(kind: ReportKind, filter: ReportFilter & { months?: number } = {}): ReportResult {
    switch (kind) {
      case 'daily':
        return { kind, rows: dailySummary(this.store, sanitizeReportFilter(filter)) }
      case 'monthly':
        return { kind, rows: monthlySummary(this.store, sanitizeReportFilter(filter)) }
      case 'category':
        return { kind, rows: categorySummary(this.store, sanitizeReportFilter(filter)) }
      case 'trend': {
        const months = filter.months ?? 6
        if (!Number.isInteger(months) || months < 1 || months > MAX_REPORT_MONTHS) {
          throw new LedgerError(`Invalid months: "${months}" (expected an integer between 1 and ${MAX_REPORT_MONTHS})`)
        }
        // The trend window defines its own month range; a month filter is not applicable.
        const trendFilter = { ...sanitizeReportFilter(filter) }
        delete trendFilter.month
        return { kind, rows: trend(this.store, months, trendFilter, this.now()) }
      }
      default:
        throw new LedgerError(`Invalid report kind: "${kind}" (expected daily, monthly, category or trend)`)
    }
  }

  exportEntries(filter: EntryFilter, format: 'csv' | 'html', outDir: string): ExportResult {
    if (format !== 'csv' && format !== 'html') {
      throw new LedgerError(`Invalid export format: "${format}" (expected csv or html)`)
    }
    return exportEntries(this.store, sanitizeFilter(filter), format, outDir, {
      currency: this.defaultCurrency,
    })
  }

  /** Budget statuses for a month/category (used by the budget tool). */
  budgetStatus(month: string, category: string, extraCents = 0, type: EntryType = 'expense') {
    validateMonth(month)
    // Normalize like setBudget does, so "set 餐饮" and "check 餐饮 " agree.
    const cat = normalizeCategory(category)
    return checkBudgets(this.store, month, cat, extraCents, type)
  }
}

function sanitizeRemark(remark: string | undefined): string {
  const cleaned = (remark ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '')
  return cleaned.slice(0, MAX_REMARK_LENGTH)
}

function sanitizeTags(tags: string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/[\u0000-\u001f\u007f"\\]/g, '').slice(0, MAX_TAG_LENGTH)
    if (tag && !out.includes(tag)) out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

function sanitizeKeyword(keyword: string): string {
  const kw = keyword.trim().replace(/[\u0000-\u001f\u007f]/g, '').toLowerCase()
  if (!kw) throw new LedgerError('Invalid rule: keyword is empty')
  if (kw.length > MAX_KEYWORD_LENGTH) throw new LedgerError('Invalid rule: keyword too long (max 50 characters)')
  return kw
}

function validateMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new LedgerError(`Invalid month: "${month}" (expected YYYY-MM)`)
  }
  const [, m] = month.split('-').map(Number)
  if (m < 1 || m > 12) throw new LedgerError(`Invalid month: "${month}"`)
}

function sanitizeFilter(filter: EntryFilter): EntryFilter {
  const out: EntryFilter = { ...filter }
  if (filter.month !== undefined) validateMonth(filter.month)
  if (filter.start !== undefined) {
    if (!isValidDate(filter.start)) {
      throw new LedgerError(`Invalid start date: "${filter.start}" (expected a valid YYYY-MM-DD or YYYY-MM)`)
    }
    // Month bounds must expand to full days or the lexicographic comparison matches nothing.
    out.start = normalizeBound(filter.start, 'start')
  }
  if (filter.end !== undefined) {
    if (!isValidDate(filter.end)) {
      throw new LedgerError(`Invalid end date: "${filter.end}" (expected a valid YYYY-MM-DD or YYYY-MM)`)
    }
    out.end = normalizeBound(filter.end, 'end')
  }
  if (filter.type !== undefined && filter.type !== 'expense' && filter.type !== 'income') {
    throw new LedgerError(`Invalid type filter: "${filter.type}" (expected expense or income)`)
  }
  if (filter.category !== undefined) {
    // Entries are stored normalized, so filters must be too.
    out.category = normalizeCategory(filter.category)
  }
  if (filter.tag !== undefined) {
    // Tags are trimmed on write, so filters must be trimmed too.
    out.tag = filter.tag.trim()
  }
  if (filter.limit !== undefined) {
    out.limit = Number.isNaN(filter.limit)
      ? 1
      : Math.min(Math.max(Math.trunc(filter.limit), 1), 200)
  }
  return out
}

function sanitizeReportFilter(filter: ReportFilter): ReportFilter {
  const out: ReportFilter = { ...filter }
  if (filter.month !== undefined) validateMonth(filter.month)
  if (filter.start !== undefined && !isValidDate(filter.start)) {
    throw new LedgerError(`Invalid start date: "${filter.start}" (expected a valid YYYY-MM-DD or YYYY-MM)`)
  }
  if (filter.end !== undefined && !isValidDate(filter.end)) {
    throw new LedgerError(`Invalid end date: "${filter.end}" (expected a valid YYYY-MM-DD or YYYY-MM)`)
  }
  if (filter.type !== undefined && filter.type !== 'expense' && filter.type !== 'income' && filter.type !== 'all') {
    throw new LedgerError(`Invalid type filter: "${filter.type}" (expected expense, income or all)`)
  }
  if (filter.category !== undefined) {
    out.category = normalizeCategory(filter.category)
  }
  return out
}
