/** Monthly budget checks and warnings. */

import { formatCents } from './money.js'
import type { BookkeepingStore } from './store.js'
import type { EntryType } from './types.js'

/** Ratio at which a budget starts warning (>= 80%). */
export const NEAR_RATIO = 0.8

export type BudgetLevel = 'ok' | 'near' | 'over'

export interface BudgetStatus {
  month: string
  /** '*' for the overall budget, otherwise the category name. */
  category: string
  limitCents: number
  /** Expenses in the month (plus `extraCents` when applicable). */
  spentCents: number
  usedRatio: number
  level: BudgetLevel
}

/**
 * Evaluate every budget that applies to (month, category). Requesting the
 * overall scope ('*') reports ALL budgets of the month (overall plus every
 * category); any other category reports the overall budget plus that
 * category's budget. `extraCents` is the amount of the entry being recorded;
 * it only counts for expense entries.
 */
export function checkBudgets(
  store: BookkeepingStore,
  month: string,
  category: string,
  extraCents = 0,
  type: EntryType = 'expense',
): BudgetStatus[] {
  const extra = type === 'expense' ? extraCents : 0
  const all = store.listBudgets(month)
  const relevant = category === '*'
    ? all
    : all.filter((b) => b.category === '*' || b.category === category)
  return relevant.map((b) => {
    const spent = store.spend(month, 'expense', b.category === '*' ? undefined : b.category) + extra
    const ratio = spent / b.limitCents
    const level: BudgetLevel = ratio >= 1 ? 'over' : ratio >= NEAR_RATIO ? 'near' : 'ok'
    return { month, category: b.category, limitCents: b.limitCents, spentCents: spent, usedRatio: ratio, level }
  })
}

/**
 * Human-readable warning lines for statuses that are near or over budget.
 * `currency` is used for display only; budgets sum recorded minor units.
 */
export function budgetMessages(statuses: readonly BudgetStatus[], currency = 'CNY'): string[] {
  const lines: string[] = []
  for (const s of statuses) {
    if (s.level === 'ok') continue
    const scope = s.category === '*' ? 'Overall budget' : `Budget for "${s.category}"`
    const spent = formatCents(s.spentCents, currency)
    const limit = formatCents(s.limitCents, currency)
    if (s.level === 'over') {
      lines.push(`⚠ ${scope} over budget: spent ${spent} of ${limit}`)
    } else {
      lines.push(`⚠ ${scope} near budget limit: spent ${spent} of ${limit} (${Math.round(s.usedRatio * 100)}%)`)
    }
  }
  return lines
}
