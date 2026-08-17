/** SQLite persistence layer (better-sqlite3, synchronous). */

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { monthRange } from './dateutil.js'
import { DB_FILE } from './paths.js'
import type {
  BudgetRow,
  CategoryRule,
  Entry,
  EntryFilter,
  EntryType,
  NewEntry,
} from './types.js'

/** Default page size for interactive listings. */
const DEFAULT_LIST_LIMIT = 50
/** Hard cap for interactive listings. */
const DEFAULT_LIST_LIMIT_MAX = 200
/** Cap used by exports (personal ledgers never get close). */
export const EXPORT_LIST_LIMIT_MAX = 1_000_000

interface EntryRow {
  id: number
  amount_cents: number
  currency: string
  type: EntryType
  category: string
  remark: string
  tags: string
  date: string
  created_at: string
}

interface RuleRow {
  keyword: string
  category: string
  created_at: string
}

interface BudgetRowRow {
  month: string
  category: string
  limit_cents: number
  created_at: string
}

interface SumRow {
  amount: number | null
  count: number
}

export class BookkeepingStore {
  /** Raw database handle, exposed for read-only aggregation queries. */
  readonly db: Database.Database

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.db = new Database(join(dataDir, DB_FILE))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency TEXT NOT NULL DEFAULT 'CNY',
        type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
        category TEXT NOT NULL,
        remark TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
      CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);
      CREATE TABLE IF NOT EXISTS category_rules (
        keyword TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budgets (
        month TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '*',
        limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
        created_at TEXT NOT NULL,
        PRIMARY KEY (month, category)
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  close(): void {
    this.db.close()
  }

  addEntry(input: NewEntry): Entry {
    const info = this.db
      .prepare(
        `INSERT INTO entries (amount_cents, currency, type, category, remark, tags, date, created_at)
         VALUES (@amountCents, @currency, @type, @category, @remark, @tags, @date, @createdAt)`,
      )
      .run({ ...input, tags: JSON.stringify(input.tags) })
    return this.getEntry(Number(info.lastInsertRowid))!
  }

  getEntry(id: number): Entry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined
    return row ? mapEntry(row) : null
  }

  listEntries(filter: EntryFilter = {}, options: { maxLimit?: number } = {}): Entry[] {
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.month) {
      const { start, end } = monthRange(filter.month)
      clauses.push('date >= ?', 'date <= ?')
      params.push(start, end)
    }
    if (filter.start) {
      clauses.push('date >= ?')
      params.push(filter.start)
    }
    if (filter.end) {
      clauses.push('date <= ?')
      params.push(filter.end)
    }
    if (filter.category) {
      clauses.push('category = ?')
      params.push(filter.category)
    }
    if (filter.type) {
      clauses.push('type = ?')
      params.push(filter.type)
    }
    if (filter.tag) {
      // Exact tag match over the JSON array, not a substring match.
      clauses.push('EXISTS (SELECT 1 FROM json_each(entries.tags) AS jt WHERE jt.value = ?)')
      params.push(filter.tag)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const maxLimit = Math.max(options.maxLimit ?? DEFAULT_LIST_LIMIT_MAX, 1)
    const limit = filter.limit === undefined
      ? Math.min(DEFAULT_LIST_LIMIT, maxLimit)
      : Math.min(Math.max(Math.trunc(filter.limit), 1), maxLimit)
    const offset = Math.max(filter.offset ?? 0, 0)
    const rows = this.db
      .prepare(`SELECT * FROM entries${where} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EntryRow[]
    return rows.map(mapEntry)
  }

  removeEntry(id: number): boolean {
    return this.db.prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0
  }

  addRule(keyword: string, category: string): CategoryRule {
    const createdAt = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO category_rules (keyword, category, created_at) VALUES (?, ?, ?) '
        + 'ON CONFLICT(keyword) DO UPDATE SET category = excluded.category, created_at = excluded.created_at',
      )
      .run(keyword, category, createdAt)
    return { keyword, category, createdAt }
  }

  removeRule(keyword: string): boolean {
    return this.db.prepare('DELETE FROM category_rules WHERE keyword = ?').run(keyword).changes > 0
  }

  listRules(): CategoryRule[] {
    const rows = this.db.prepare('SELECT * FROM category_rules ORDER BY keyword').all() as RuleRow[]
    return rows.map((r) => ({ keyword: r.keyword, category: r.category, createdAt: r.created_at }))
  }

  setBudget(month: string, category: string, limitCents: number): BudgetRow {
    const createdAt = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO budgets (month, category, limit_cents, created_at) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(month, category) DO UPDATE SET limit_cents = excluded.limit_cents, created_at = excluded.created_at',
      )
      .run(month, category, limitCents, createdAt)
    return { month, category, limitCents, createdAt }
  }

  removeBudget(month: string, category: string): boolean {
    return this.db.prepare('DELETE FROM budgets WHERE month = ? AND category = ?').run(month, category).changes > 0
  }

  getBudget(month: string, category: string): BudgetRow | null {
    const row = this.db
      .prepare('SELECT * FROM budgets WHERE month = ? AND category = ?')
      .get(month, category) as BudgetRowRow | undefined
    return row ? mapBudget(row) : null
  }

  listBudgets(month?: string): BudgetRow[] {
    const rows = month
      ? this.db.prepare('SELECT * FROM budgets WHERE month = ? ORDER BY category').all(month) as BudgetRowRow[]
      : this.db.prepare('SELECT * FROM budgets ORDER BY month, category').all() as BudgetRowRow[]
    return rows.map(mapBudget)
  }

  /** Sum of entries of a type in a month, optionally restricted to a category. */
  spend(month: string, type: EntryType, category?: string): number {
    const { start, end } = monthRange(month)
    const row = category === undefined
      ? this.db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM entries WHERE date >= ? AND date <= ? AND type = ?')
        .get(start, end, type) as SumRow
      : this.db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS amount FROM entries WHERE date >= ? AND date <= ? AND type = ? AND category = ?')
        .get(start, end, type, category) as SumRow
    return Number(row.amount)
  }

  /** Expense and income totals for a month. */
  monthTotals(month: string): { expenseCents: number; incomeCents: number } {
    const { start, end } = monthRange(month)
    const rows = this.db
      .prepare('SELECT type, SUM(amount_cents) AS amount FROM entries WHERE date >= ? AND date <= ? GROUP BY type')
      .all(start, end) as { type: EntryType; amount: number | null }[]
    let expenseCents = 0
    let incomeCents = 0
    for (const row of rows) {
      if (row.type === 'expense') expenseCents = Number(row.amount)
      else incomeCents = Number(row.amount)
    }
    return { expenseCents, incomeCents }
  }
}

function mapEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency,
    type: row.type,
    category: row.category,
    remark: row.remark,
    tags: JSON.parse(row.tags) as string[],
    date: row.date,
    createdAt: row.created_at,
  }
}

function mapBudget(row: BudgetRowRow): BudgetRow {
  return {
    month: row.month,
    category: row.category,
    limitCents: row.limit_cents,
    createdAt: row.created_at,
  }
}
