import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookkeepingStore } from '../src/store.js'
import { Ledger } from '../src/ledger.js'
import { checkBudgets, budgetMessages, NEAR_RATIO } from '../src/budget.js'

const NOW = new Date(2026, 7, 17, 12, 0, 0)

describe('budget', () => {
  let dir: string
  let store: BookkeepingStore
  let ledger: Ledger

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-budget-'))
    store = new BookkeepingStore(dir)
    ledger = new Ledger({ store, now: () => NOW })
  })
  after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns no status when no budget is set', () => {
    assert.deepEqual(checkBudgets(store, '2026-08', '餐饮'), [])
  })

  it('computes ok / near / over levels for the overall budget', () => {
    ledger.setBudget({ month: '2026-08', amountText: '100' })
    store.addEntry({ amountCents: 5000, currency: 'CNY', type: 'expense', category: '餐饮', remark: '', tags: [], date: '2026-08-01', createdAt: '' })

    let statuses = checkBudgets(store, '2026-08', '餐饮')
    assert.equal(statuses.length, 1)
    assert.equal(statuses[0].level, 'ok')

    // 80 / 100 → near
    store.addEntry({ amountCents: 3000, currency: 'CNY', type: 'expense', category: '交通', remark: '', tags: [], date: '2026-08-02', createdAt: '' })
    statuses = checkBudgets(store, '2026-08', '餐饮')
    assert.equal(statuses[0].level, 'near')
    assert.equal(statuses[0].usedRatio, NEAR_RATIO)

    // 99 / 100 → still near (ratio < 1)
    store.addEntry({ amountCents: 1900, currency: 'CNY', type: 'expense', category: '娱乐', remark: '', tags: [], date: '2026-08-03', createdAt: '' })
    statuses = checkBudgets(store, '2026-08', '餐饮')
    assert.equal(statuses[0].level, 'near')

    // +2 → over
    statuses = checkBudgets(store, '2026-08', '餐饮', 200)
    assert.equal(statuses[0].level, 'over')

    // income never consumes a budget: extra cents are ignored for income entries
    const income = checkBudgets(store, '2026-08', '收入', 999999, 'income')
    assert.equal(income.length, 1)
    assert.equal(income[0].spentCents, 9900)
    assert.equal(income[0].level, 'near')
  })

  it('checks category-scoped budgets and ignores other categories', () => {
    ledger.setBudget({ month: '2026-08', category: '餐饮', amountText: '10' })
    const statuses = checkBudgets(store, '2026-08', '餐饮')
    const food = statuses.find((s) => s.category === '餐饮')!
    assert.ok(food)
    assert.equal(food.level, 'over')

    // an entry in another category must not count toward the food budget
    store.addEntry({ amountCents: 5000, currency: 'CNY', type: 'expense', category: '交通', remark: '', tags: [], date: '2026-08-04', createdAt: '' })
    const again = checkBudgets(store, '2026-08', '餐饮')
    assert.equal(again.find((s) => s.category === '餐饮')!.spentCents, 5000)
  })

  it('messages describe over and near budgets', () => {
    assert.ok(budgetMessages(checkBudgets(store, '2026-08', '餐饮')).length > 0)
    ledger.setBudget({ month: '2026-09', amountText: '100000' })
    assert.deepEqual(budgetMessages(checkBudgets(store, '2026-09', '餐饮')), [])
  })

  it('setBudget validates amounts and supports removal via zero', () => {
    assert.throws(() => ledger.setBudget({ month: '2026-08', amountText: 'abc' }), /amount/i)
    const removed = ledger.setBudget({ month: '2026-08', category: '餐饮', amountText: '0' })
    assert.equal(removed.removed, true)
    assert.equal(ledger.budgets('2026-08').some((b) => b.category === '餐饮'), false)
  })

  it('flags over-budget warnings on add', () => {
    ledger.setBudget({ month: '2026-08', amountText: '1' })
    const { warnings } = ledger.add({ amountText: '2', remark: '超支测试' })
    assert.ok(warnings.some((w) => w.includes('over budget') || w.includes('预算') || w.includes('超支')))
  })

  it('warns with exact post-add figures (no double counting)', () => {
    // Fresh store: budget 200.00, spend 100.00, then record +50.00.
    // The warning must show 150.00 / 200.00 (75%, level ok), not 200.00/200.00.
    const dir2 = mkdtempSync(join(tmpdir(), 'dsh-bk-budget2-'))
    const store2 = new BookkeepingStore(dir2)
    const ledger2 = new Ledger({ store: store2, now: () => NOW })
    try {
      ledger2.setBudget({ month: '2026-08', amountText: '200' })
      store2.addEntry({ amountCents: 10000, currency: 'CNY', type: 'expense', category: '餐饮', remark: '', tags: [], date: '2026-08-01', createdAt: '' })
      const { warnings } = ledger2.add({ amountText: '50', remark: '午饭' })
      const statuses = checkBudgets(store2, '2026-08', '餐饮')
      // Pre-insert spend (100) + the new entry (50) counted once.
      assert.equal(statuses[0].spentCents, 15000)
      assert.equal(statuses[0].level, 'ok')
      assert.deepEqual(warnings, [])
    } finally {
      store2.close()
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('formats warnings in the ledger default currency', () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'dsh-bk-budget3-'))
    const store3 = new BookkeepingStore(dir3)
    const ledger3 = new Ledger({ store: store3, now: () => NOW, defaultCurrency: 'USD' })
    try {
      ledger3.setBudget({ month: '2026-08', amountText: '100' })
      store3.addEntry({ amountCents: 9000, currency: 'USD', type: 'expense', category: '餐饮', remark: '', tags: [], date: '2026-08-01', createdAt: '' })
      const { warnings } = ledger3.add({ amountText: '5', remark: '咖啡' })
      assert.ok(warnings.some((w) => w.includes('$95.00') && w.includes('$100.00')))
    } finally {
      store3.close()
      rmSync(dir3, { recursive: true, force: true })
    }
  })

  it('denominates budget amounts in a zero-decimal default currency', () => {
    const dir6 = mkdtempSync(join(tmpdir(), 'dsh-bk-budget6-'))
    const store6 = new BookkeepingStore(dir6)
    const ledgerJpy = new Ledger({ store: store6, now: () => NOW, defaultCurrency: 'JPY' })
    try {
      const { row } = ledgerJpy.setBudget({ month: '2026-08', amountText: '5000' })
      assert.equal(row!.limitCents, 5000)
      // A ¥5000 expense (5000 minor units) therefore exactly fills the budget.
      store6.addEntry({ amountCents: 5000, currency: 'JPY', type: 'expense', category: '餐饮', remark: '', tags: [], date: '2026-08-01', createdAt: '' })
      const statuses = ledgerJpy.budgetStatus('2026-08', '*')
      assert.equal(statuses[0].level, 'over')
    } finally {
      store6.close()
      rmSync(dir6, { recursive: true, force: true })
    }
  })

  it('rejects invalid month strings on read paths', () => {
    assert.throws(() => ledger.budgetStatus('2026-99', '*'), /month/i)
    assert.throws(() => ledger.budgetStatus('abc', '*'), /month/i)
  })

  it('matches category-scoped budgets with padded category names on check', () => {
    ledger.setBudget({ month: '2026-08', category: '娱乐', amountText: '10' })
    const statuses = ledger.budgetStatus('2026-08', '娱乐 ')
    assert.ok(statuses.some((s) => s.category === '娱乐'), 'padded category must find the scoped budget')
    const raw = checkBudgets(store, '2026-08', '娱乐 ')
    assert.equal(raw.filter((s) => s.category === '娱乐').length, 0, 'un-normalized check misses it')
  })

  it('reports every budget of the month when checking the overall scope', () => {
    const statuses = checkBudgets(store, '2026-08', '*')
    const categories = statuses.map((s) => s.category)
    assert.ok(categories.includes('*'), 'overall budget included')
    assert.ok(categories.includes('娱乐'), 'category budget included for an overall check')
  })
})
