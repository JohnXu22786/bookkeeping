import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookkeepingStore } from '../src/store.js'
import {
  dailySummary,
  monthlySummary,
  categorySummary,
  trend,
  periodTotals,
} from '../src/report.js'

const NOW = new Date(2026, 7, 17, 12, 0, 0)

describe('report', () => {
  let dir: string
  let store: BookkeepingStore

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-report-'))
    store = new BookkeepingStore(dir)
    const base = {
      currency: 'CNY' as const,
      remark: '',
      tags: [] as string[],
      createdAt: '',
    }
    store.addEntry({ ...base, amountCents: 1500, type: 'expense', category: '餐饮', date: '2026-07-05' })
    store.addEntry({ ...base, amountCents: 2500, type: 'expense', category: '餐饮', date: '2026-08-01' })
    store.addEntry({ ...base, amountCents: 800, type: 'expense', category: '交通', date: '2026-08-02' })
    store.addEntry({ ...base, amountCents: 100000, type: 'income', category: '收入', date: '2026-08-10' })
    store.addEntry({ ...base, amountCents: 300, type: 'expense', category: '娱乐', date: '2026-08-10' })
    store.addEntry({ ...base, amountCents: 100, type: 'expense', category: '餐饮', date: '2026-09-01' })
  })
  after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('dailySummary aggregates per day in ascending order', () => {
    const rows = dailySummary(store, { start: '2026-08-01', end: '2026-08-31' })
    assert.equal(rows.length, 3)
    assert.deepEqual(rows[0], { date: '2026-08-01', expenseCents: 2500, incomeCents: 0, count: 1 })
    assert.deepEqual(rows[1], { date: '2026-08-02', expenseCents: 800, incomeCents: 0, count: 1 })
    assert.deepEqual(rows[2], { date: '2026-08-10', expenseCents: 300, incomeCents: 100000, count: 2 })
  })

  it('dailySummary respects type and category filters', () => {
    const income = dailySummary(store, { start: '2026-08-01', end: '2026-08-31', type: 'income' })
    assert.equal(income.length, 1)
    assert.equal(income[0].incomeCents, 100000)
    assert.equal(income[0].expenseCents, 0)
    const food = dailySummary(store, { start: '2026-08-01', end: '2026-08-31', category: '餐饮' })
    assert.equal(food.length, 1)
    assert.equal(food[0].expenseCents, 2500)
  })

  it('monthlySummary aggregates per month with net', () => {
    const rows = monthlySummary(store, { start: '2026-07', end: '2026-09' })
    assert.deepEqual(rows, [
      { month: '2026-07', expenseCents: 1500, incomeCents: 0, netCents: -1500, count: 1 },
      { month: '2026-08', expenseCents: 3600, incomeCents: 100000, netCents: 96400, count: 4 },
      { month: '2026-09', expenseCents: 100, incomeCents: 0, netCents: -100, count: 1 },
    ])
  })

  it('monthlySummary accepts month bounds as YYYY-MM', () => {
    const rows = monthlySummary(store, { start: '2026-08', end: '2026-08' })
    assert.deepEqual(rows, [
      { month: '2026-08', expenseCents: 3600, incomeCents: 100000, netCents: 96400, count: 4 },
    ])
  })

  it('categorySummary groups by category, sorted by amount desc, shares sum to 1', () => {
    const rows = categorySummary(store, { start: '2026-08-01', end: '2026-08-31', type: 'expense' })
    assert.deepEqual(rows.map((r) => [r.category, r.amountCents, r.count]), [
      ['餐饮', 2500, 1],
      ['交通', 800, 1],
      ['娱乐', 300, 1],
    ])
    assert.equal(rows.reduce((acc, r) => acc + r.share, 0), 1)
    assert.ok(rows.every((r) => r.share > 0 && r.share <= 1))
  })

  it('categorySummary honors a category filter', () => {
    const rows = categorySummary(store, { start: '2026-08-01', end: '2026-08-31', category: '交通' })
    assert.deepEqual(rows, [{ category: '交通', amountCents: 800, count: 1, share: 1 }])
  })

  it('trend zero-fills months and ends at the current month', () => {
    const rows = trend(store, 4, {}, NOW)
    assert.deepEqual(rows.map((r) => r.month), ['2026-05', '2026-06', '2026-07', '2026-08'])
    assert.deepEqual(rows[0], { month: '2026-05', expenseCents: 0, incomeCents: 0 })
    assert.deepEqual(rows[2], { month: '2026-07', expenseCents: 1500, incomeCents: 0 })
    assert.deepEqual(rows[3], { month: '2026-08', expenseCents: 3600, incomeCents: 100000 })
  })

  it('trend honors filters', () => {
    const rows = trend(store, 3, { type: 'income' }, NOW)
    assert.equal(rows[2].incomeCents, 100000)
    assert.equal(rows[2].expenseCents, 0)
  })

  it('periodTotals sums amounts and count within a filter', () => {
    assert.deepEqual(periodTotals(store, { month: '2026-08' }), { expenseCents: 3600, incomeCents: 100000, count: 4 })
    assert.deepEqual(periodTotals(store, { month: '2026-08', type: 'expense' }), { expenseCents: 3600, incomeCents: 0, count: 3 })
    assert.deepEqual(periodTotals(store, { start: '2026-01-01', end: '2026-12-31' }), { expenseCents: 5200, incomeCents: 100000, count: 6 })
  })
})
