/** Shared human-readable text formatting (used by both the tools and the CLI). */

import type { BudgetStatus } from './budget.js'
import type { CategoryInfo } from './categories.js'
import { formatCents } from './money.js'
import type {
  CategoryRow,
  DailyRow,
  MonthlyRow,
  PeriodTotals,
  TrendRow,
} from './report.js'
import type { BudgetRow, CategoryRule, Entry } from './types.js'

/** One-line entry description, e.g. "#12 2026-08-17 餐饮 -¥35.00 午饭 [外卖]". */
export function formatEntryLine(e: Entry, options: { withId?: boolean } = {}): string {
  const id = options.withId ? `#${e.id} ` : ''
  const sign = e.type === 'expense' ? '-' : '+'
  const tags = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : ''
  return `${id}${e.date} ${e.category} ${sign}${formatCents(e.amountCents, e.currency)} ${e.remark}${tags}`.trimEnd()
}

/** Entry list with a trailing totals line. */
export function formatList(entries: readonly Entry[], totals: PeriodTotals, currency = 'CNY'): string {
  const lines = entries.map((e) => formatEntryLine(e, { withId: true }))
  if (entries.length === 0) return 'No entries found'
  lines.push(`Total: expense ${formatCents(totals.expenseCents, currency)}, income ${formatCents(totals.incomeCents, currency)}, ${entries.length} entries`)
  return lines.join('\n')
}

export function formatDaily(rows: readonly DailyRow[], currency = 'CNY'): string {
  if (rows.length === 0) return 'No data for the period'
  return rows.map((r) => (
    `${r.date}: expense ${formatCents(r.expenseCents, currency)}, income ${formatCents(r.incomeCents, currency)} (${r.count} entry/entries)`
  )).join('\n')
}

export function formatMonthly(rows: readonly MonthlyRow[], currency = 'CNY'): string {
  if (rows.length === 0) return 'No data for the period'
  return rows.map((r) => (
    `${r.month}: expense ${formatCents(r.expenseCents, currency)}, income ${formatCents(r.incomeCents, currency)}, net ${formatCents(r.netCents, currency)} (${r.count} entry/entries)`
  )).join('\n')
}

export function formatCategory(rows: readonly CategoryRow[], currency = 'CNY'): string {
  if (rows.length === 0) return 'No data for the period'
  return rows.map((r) => (
    `${r.category}: ${formatCents(r.amountCents, currency)} (${r.count} entry/entries, ${Math.round(r.share * 100)}%)`
  )).join('\n')
}

export function formatTrend(rows: readonly TrendRow[], currency = 'CNY'): string {
  if (rows.length === 0) return 'No data'
  return rows.map((r) => (
    `${r.month}: expense ${formatCents(r.expenseCents, currency)}, income ${formatCents(r.incomeCents, currency)}`
  )).join('\n')
}

export function formatBudgetStatus(statuses: readonly BudgetStatus[], currency = 'CNY'): string {
  if (statuses.length === 0) return 'No budget is set for this month'
  return statuses.map((s) => {
    const scope = s.category === '*' ? 'Overall' : s.category
    const label = s.level === 'over' ? 'OVER' : s.level === 'near' ? 'NEAR' : 'ok'
    return `${label.padEnd(4)} ${scope}: ${formatCents(s.spentCents, currency)} / ${formatCents(s.limitCents, currency)} (${Math.round(s.usedRatio * 100)}%)`
  }).join('\n')
}

export function formatBudgets(rows: readonly BudgetRow[], currency = 'CNY'): string {
  if (rows.length === 0) return 'No budgets set'
  return rows.map((b) => (
    `${b.month} ${b.category === '*' ? '(overall)' : b.category}: limit ${formatCents(b.limitCents, currency)}`
  )).join('\n')
}

export function formatCategories(builtin: readonly CategoryInfo[], rules: readonly CategoryRule[]): string {
  const lines = builtin.map((c) => `${c.name} (${c.kind})`)
  if (rules.length > 0) lines.push('Custom rules:', ...rules.map((r) => `  ${r.keyword} -> ${r.category}`))
  return lines.join('\n')
}

export function formatRules(rules: readonly CategoryRule[]): string {
  if (rules.length === 0) return 'No custom rules'
  return rules.map((r) => `${r.keyword} -> ${r.category}`).join('\n')
}
