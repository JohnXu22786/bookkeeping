/** Aggregation queries: daily / monthly / category summaries and trends. */

import { addMonths, currentMonth, monthRange, normalizeBound } from './dateutil.js'
import type { BookkeepingStore } from './store.js'
import type { EntryType } from './types.js'

export type TypeFilter = EntryType | 'all'

export interface ReportFilter {
  type?: TypeFilter
  category?: string
  /** YYYY-MM-DD or YYYY-MM. */
  start?: string
  /** YYYY-MM-DD or YYYY-MM. */
  end?: string
  /** YYYY-MM. */
  month?: string
}

export interface DailyRow {
  date: string
  expenseCents: number
  incomeCents: number
  count: number
}

export interface MonthlyRow {
  month: string
  expenseCents: number
  incomeCents: number
  netCents: number
  count: number
}

export interface CategoryRow {
  category: string
  amountCents: number
  count: number
  /** Share (0..1] of the total amount in the filtered result. */
  share: number
}

export interface TrendRow {
  month: string
  expenseCents: number
  incomeCents: number
}

export type ReportKind = 'daily' | 'monthly' | 'category' | 'trend'

export type ReportRows = DailyRow[] | MonthlyRow[] | CategoryRow[] | TrendRow[]

export interface ReportResult {
  kind: ReportKind
  rows: ReportRows
}

export interface PeriodTotals {
  expenseCents: number
  incomeCents: number
  count: number
}

function whereClause(filter: ReportFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (filter.month) {
    const { start, end } = monthRange(filter.month)
    clauses.push('date >= ?', 'date <= ?')
    params.push(start, end)
  }
  if (filter.start) {
    clauses.push('date >= ?')
    params.push(normalizeBound(filter.start, 'start'))
  }
  if (filter.end) {
    clauses.push('date <= ?')
    params.push(normalizeBound(filter.end, 'end'))
  }
  if (filter.category) {
    clauses.push('category = ?')
    params.push(filter.category)
  }
  if (filter.type && filter.type !== 'all') {
    clauses.push('type = ?')
    params.push(filter.type)
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params }
}

interface TypeAmountRow {
  type: EntryType
  amount: number | null
  count: number
}

function totalsFor(rows: readonly TypeAmountRow[]): { expenseCents: number; incomeCents: number; count: number } {
  let expenseCents = 0
  let incomeCents = 0
  let count = 0
  for (const row of rows) {
    count += row.count
    if (row.type === 'expense') expenseCents = Number(row.amount ?? 0)
    else incomeCents = Number(row.amount ?? 0)
  }
  return { expenseCents, incomeCents, count }
}

/** Per-day expense/income totals in ascending date order. */
export function dailySummary(store: BookkeepingStore, filter: ReportFilter = {}): DailyRow[] {
  const { sql, params } = whereClause(filter)
  const rows = store.db
    .prepare(`SELECT date, type, SUM(amount_cents) AS amount, COUNT(*) AS count FROM entries${sql} GROUP BY date, type ORDER BY date`)
    .all(...params) as unknown as TypeAmountRow[] & { date: string }[]
  const byDate = new Map<string, DailyRow>()
  for (const row of rows) {
    const day = byDate.get(row.date) ?? { date: row.date, expenseCents: 0, incomeCents: 0, count: 0 }
    day.count += row.count
    if (row.type === 'expense') day.expenseCents = Number(row.amount ?? 0)
    else day.incomeCents = Number(row.amount ?? 0)
    byDate.set(row.date, day)
  }
  return [...byDate.values()]
}

/** Per-month expense/income/net totals in ascending month order. */
export function monthlySummary(store: BookkeepingStore, filter: ReportFilter = {}): MonthlyRow[] {
  const { sql, params } = whereClause(filter)
  const rows = store.db
    .prepare(`SELECT substr(date, 1, 7) AS month, type, SUM(amount_cents) AS amount, COUNT(*) AS count FROM entries${sql} GROUP BY month, type ORDER BY month`)
    .all(...params) as unknown as TypeAmountRow[] & { month: string }[]
  const byMonth = new Map<string, { expenseCents: number; incomeCents: number; count: number }>()
  for (const row of rows) {
    const bucket = byMonth.get(row.month) ?? { expenseCents: 0, incomeCents: 0, count: 0 }
    bucket.count += row.count
    if (row.type === 'expense') bucket.expenseCents = Number(row.amount ?? 0)
    else bucket.incomeCents = Number(row.amount ?? 0)
    byMonth.set(row.month, bucket)
  }
  return [...byMonth.entries()].map(([month, b]) => ({
    month,
    expenseCents: b.expenseCents,
    incomeCents: b.incomeCents,
    // Net is positive when income exceeds spending (a surplus).
    netCents: b.incomeCents - b.expenseCents,
    count: b.count,
  }))
}

/** Per-category totals, sorted by amount descending, with share of the total. */
export function categorySummary(store: BookkeepingStore, filter: ReportFilter = {}): CategoryRow[] {
  const { sql, params } = whereClause(filter)
  const rows = store.db
    .prepare(`SELECT category, SUM(amount_cents) AS amount, COUNT(*) AS count FROM entries${sql} GROUP BY category ORDER BY amount DESC`)
    .all(...params) as { category: string; amount: number | null; count: number }[]
  const total = rows.reduce((acc, r) => acc + Number(r.amount ?? 0), 0)
  return rows.map((r) => ({
    category: r.category,
    amountCents: Number(r.amount ?? 0),
    count: r.count,
    share: total > 0 ? Number(r.amount ?? 0) / total : 0,
  }))
}

/** Monthly totals for the last `months` months ending at `now`, zero-filled. */
export function trend(store: BookkeepingStore, months: number, filter: ReportFilter = {}, now: Date = new Date()): TrendRow[] {
  const last = currentMonth(now)
  const first = addMonths(last, -(months - 1))
  const byMonth = new Map(
    monthlySummary(store, { ...filter, start: first, end: last }).map((r) => [r.month, r]),
  )
  const rows: TrendRow[] = []
  for (let i = 0; i < months; i += 1) {
    const month = addMonths(first, i)
    const bucket = byMonth.get(month)
    rows.push({
      month,
      expenseCents: bucket?.expenseCents ?? 0,
      incomeCents: bucket?.incomeCents ?? 0,
    })
  }
  return rows
}

/** Total expense/income/count over a filter. */
export function periodTotals(store: BookkeepingStore, filter: ReportFilter = {}): PeriodTotals {
  const { sql, params } = whereClause(filter)
  const rows = store.db
    .prepare(`SELECT type, SUM(amount_cents) AS amount, COUNT(*) AS count FROM entries${sql} GROUP BY type`)
    .all(...params) as unknown as TypeAmountRow[]
  return totalsFor(rows)
}
