/** Shared types for the dsh-bookkeeping plugin. */

export type EntryType = 'expense' | 'income'

/** A stored ledger entry. Amounts are integer minor units (cents). */
export interface Entry {
  id: number
  amountCents: number
  currency: string
  type: EntryType
  category: string
  remark: string
  tags: string[]
  /** Entry date, normalized to YYYY-MM-DD. */
  date: string
  /** ISO 8601 timestamp of when the entry was recorded. */
  createdAt: string
}

/** Raw values accepted when recording an entry (before validation). */
export interface EntryInput {
  /** Amount as text, e.g. "35", "35.5", "¥35", "35元", "1,234.56". */
  amountText: string
  /** Explicit currency code; otherwise derived from the symbol or the default. */
  currency?: string
  /** 'expense' or 'income'; defaults to 'expense'. */
  type?: EntryType
  /** Category; when omitted it is auto-detected from remark/tags. */
  category?: string
  remark?: string
  tags?: string[]
  /** Natural-language date; defaults to today. */
  date?: string
}

/** Values that go into the database. */
export interface NewEntry {
  amountCents: number
  currency: string
  type: EntryType
  category: string
  remark: string
  tags: string[]
  date: string
  createdAt: string
}

/** Filters for listing and exporting entries. */
export interface EntryFilter {
  /** YYYY-MM */
  month?: string
  /** YYYY-MM-DD (inclusive). */
  start?: string
  /** YYYY-MM-DD or YYYY-MM (inclusive). */
  end?: string
  category?: string
  type?: EntryType
  tag?: string
  limit?: number
  offset?: number
}

/** A custom keyword → category rule. */
export interface CategoryRule {
  keyword: string
  category: string
  createdAt: string
}

/** A monthly budget row. Category '*' means the overall budget. */
export interface BudgetRow {
  month: string
  category: string
  limitCents: number
  createdAt: string
}

/** Validation/domain error with a user-facing message. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerError'
  }
}
