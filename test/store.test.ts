import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookkeepingStore } from '../src/store.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-bk-store-'))
}

function entry(overrides: Partial<Parameters<BookkeepingStore['addEntry']>[0]> = {}) {
  return {
    amountCents: 3500,
    currency: 'CNY',
    type: 'expense' as const,
    category: '餐饮',
    remark: '午饭',
    tags: [],
    date: '2026-08-17',
    createdAt: '2026-08-17T04:00:00.000Z',
    ...overrides,
  }
}

describe('BookkeepingStore', () => {
  let dir: string
  let store: BookkeepingStore

  before(() => {
    dir = tmpDir()
    store = new BookkeepingStore(dir)
  })
  after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('adds and lists entries, newest first', () => {
    const a = store.addEntry(entry({ amountCents: 1000, date: '2026-08-01', remark: 'a' }))
    const b = store.addEntry(entry({ amountCents: 2000, date: '2026-08-02', remark: 'b' }))
    const rows = store.listEntries()
    assert.equal(rows.length, 2)
    assert.equal(rows[0].id, b.id)
    assert.equal(rows[1].id, a.id)
    assert.equal(rows[0].remark, 'b')
  })

  it('round-trips tags and currency', () => {
    const e = store.addEntry(entry({ tags: ['工作餐', '外卖'], currency: 'USD', amountCents: 999 }))
    const got = store.getEntry(e.id)
    assert.deepEqual(got!.tags, ['工作餐', '外卖'])
    assert.equal(got!.currency, 'USD')
    assert.equal(got!.amountCents, 999)
  })

  it('filters by month, category, type, tag and date range', () => {
    store.addEntry(entry({ amountCents: 100, category: '餐饮', type: 'expense', date: '2026-08-05', remark: 'x' }))
    store.addEntry(entry({ amountCents: 200, category: '交通', type: 'expense', date: '2026-08-06', remark: 'y' }))
    store.addEntry(entry({ amountCents: 300, category: '收入', type: 'income', date: '2026-07-30', remark: 'z' }))
    store.addEntry(entry({ amountCents: 400, category: '餐饮', type: 'expense', date: '2026-08-07', remark: 'w', tags: ['应酬'] }))

    assert.equal(store.listEntries({ month: '2026-08' }).length, 6)
    // a, b, roundtrip(999) and the 100/400 filter entries are all 餐饮
    assert.equal(store.listEntries({ category: '餐饮' }).length, 5)
    assert.equal(store.listEntries({ type: 'income' }).length, 1)
    assert.equal(store.listEntries({ tag: '应酬' }).length, 1)
    // A tag equal to a JSON punctuation char must not match every tag-carrying row.
    assert.equal(store.listEntries({ tag: ']' }).length, 0)
    assert.equal(store.listEntries({ tag: ',' }).length, 0)
    assert.equal(store.listEntries({ tag: '不存在' }).length, 0)
    assert.deepEqual(store.listEntries({ start: '2026-08-06', end: '2026-08-06' }).map((r) => r.remark), ['y'])
    assert.equal(store.listEntries({ limit: 2 }).length, 2)
    assert.equal(store.listEntries({ limit: 1, offset: 1 }).length, 1)
    // negative/zero limits clamp to 1 instead of meaning "unlimited"
    assert.equal(store.listEntries({ limit: -5 }).length, 1)
    assert.equal(store.listEntries({ limit: 0 }).length, 1)
  })

  it('removes entries and reports missing ones', () => {
    const e = store.addEntry(entry({ remark: 'temp' }))
    assert.equal(store.removeEntry(e.id), true)
    assert.equal(store.getEntry(e.id), null)
    assert.equal(store.removeEntry(e.id), false)
  })

  it('persists data across reopen', () => {
    const e = store.addEntry(entry({ remark: 'persist-me' }))
    store.close()
    const reopened = new BookkeepingStore(dir)
    const rows = reopened.listEntries()
    assert.ok(rows.some((r) => r.id === e.id && r.remark === 'persist-me'))
    reopened.close()
    store = new BookkeepingStore(dir)
  })

  it('manages category rules', () => {
    store.addRule('咖啡豆', '购物')
    const rules = store.listRules()
    assert.ok(rules.some((r) => r.keyword === '咖啡豆' && r.category === '购物'))
    assert.equal(store.removeRule('咖啡豆'), true)
    assert.equal(store.removeRule('咖啡豆'), false)
  })

  it('manages budgets with upsert semantics', () => {
    store.setBudget('2026-08', '*', 100000)
    assert.deepEqual(store.getBudget('2026-08', '*')!.limitCents, 100000)
    store.setBudget('2026-08', '*', 200000)
    assert.deepEqual(store.getBudget('2026-08', '*')!.limitCents, 200000)
    store.setBudget('2026-08', '餐饮', 50000)
    assert.equal(store.listBudgets('2026-08').length, 2)
    assert.equal(store.listBudgets('2026-09').length, 0)
  })

  it('sums spending per month and type', () => {
    // a(1000) + b(2000) + roundtrip(999) + filter(100+200+400) + persist(3500)
    assert.equal(store.spend('2026-08', 'expense'), 8199)
    assert.equal(store.spend('2026-08', 'expense', '交通'), 200)
    assert.equal(store.spend('2026-08', 'income'), 0)
    assert.deepEqual(store.monthTotals('2026-08'), { expenseCents: 8199, incomeCents: 0 })
    assert.deepEqual(store.monthTotals('2026-07'), { expenseCents: 0, incomeCents: 300 })
  })

  it('round-trips tags that require JSON escaping', () => {
    const tags = ['slash\\back', 'quote"inside', 'multi word tag']
    const e = store.addEntry(entry({ tags, remark: 'escape', date: '2026-09-01' }))
    const got = store.getEntry(e.id)
    assert.deepEqual(got!.tags, tags)
  })
})
