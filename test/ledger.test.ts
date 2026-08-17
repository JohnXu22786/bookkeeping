import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookkeepingStore } from '../src/store.js'
import { Ledger } from '../src/ledger.js'

const NOW = new Date(2026, 7, 17, 12, 0, 0)

describe('Ledger', () => {
  let dir: string
  let store: BookkeepingStore
  let ledger: Ledger

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-ledger-'))
    store = new BookkeepingStore(dir)
    ledger = new Ledger({ store, now: () => NOW })
  })
  after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('adds an entry with auto-categorization and defaults', () => {
    const { entry: e, autoCategory, warnings } = ledger.add({ amountText: '35', remark: '午饭' })
    assert.equal(autoCategory, true)
    assert.equal(e.category, '餐饮')
    assert.equal(e.type, 'expense')
    assert.equal(e.date, '2026-08-17')
    assert.equal(e.amountCents, 3500)
    assert.equal(e.currency, 'CNY')
    assert.deepEqual(warnings, [])
  })

  it('infers income type from income-kind auto-categories', () => {
    const { entry: e } = ledger.add({ amountText: '5000', remark: '工资到账' })
    assert.equal(e.category, '收入')
    assert.equal(e.type, 'income')
    // An explicit type still wins.
    const { entry: explicit } = ledger.add({ amountText: '1', remark: '工资', type: 'expense' })
    assert.equal(explicit.type, 'expense')
  })

  it('stores rule keywords lowercase and removes them case-insensitively', () => {
    const rule = ledger.addRule('Coffee', '餐饮')
    assert.equal(rule.keyword, 'coffee')
    assert.equal(ledger.removeRule('COFFEE'), true)
  })

  it('trims tag filters', () => {
    const { entry: e } = ledger.add({ amountText: '1', remark: 'x', tags: ['工作'] })
    const hit = ledger.list({ tag: ' 工作 ' })
    assert.ok(hit.entries.some((r) => r.id === e.id))
  })

  it('rejects invalid months on budget listing', () => {
    assert.throws(() => ledger.budgets('2026-13'), /month/i)
  })

  it('honors explicit fields and resolves natural-language dates', () => {
    const { entry: e } = ledger.add({
      amountText: '¥500',
      type: 'income',
      category: '收入',
      remark: '工资',
      tags: ['8月'],
      date: '昨天',
    })
    assert.equal(e.date, '2026-08-16')
    assert.equal(e.type, 'income')
    assert.equal(e.category, '收入')
    assert.deepEqual(e.tags, ['8月'])
  })

  it('rejects invalid amounts, dates and types', () => {
    assert.throws(() => ledger.add({ amountText: 'abc', remark: 'x' }), /amount/i)
    assert.throws(() => ledger.add({ amountText: '-5', remark: 'x' }), /amount/i)
    assert.throws(() => ledger.add({ amountText: '5', date: '2026-02-30' }), /date/i)
    assert.throws(() => ledger.add({ amountText: '5', type: 'transfer' as unknown as 'expense' }), /type/i)
    // a category of only control characters is invalid after normalization
    assert.throws(() => ledger.add({ amountText: '5', category: '\u0000' }), /category/i)
  })

  it('sanitizes tags and truncates long remarks', () => {
    const { entry: e } = ledger.add({
      amountText: '1',
      remark: '长'.repeat(300),
      tags: ['a', 'a', ' 带引号"词 ', 'x'.repeat(50)],
    })
    assert.equal(e.remark.length, 200)
    assert.deepEqual(e.tags, ['a', '带引号词', 'x'.repeat(20)])
  })

  it('lists entries with totals', () => {
    const { entries, totals } = ledger.list({ month: '2026-08' })
    assert.ok(entries.length >= 1)
    assert.ok(totals.expenseCents >= 3500)
    // ¥500 salary (explicit) + ¥5000 工资到账 (auto income)
    assert.equal(totals.incomeCents, 550000)
  })

  it('categorizes text and exposes category/rule management', () => {
    assert.deepEqual(ledger.categorize('打车'), { category: '交通', matched: true, keyword: '打车' })
    assert.equal(ledger.categories().builtin.length, 9)
    ledger.addRule('加班餐', '餐饮')
    assert.ok(ledger.rulesList().some((r) => r.keyword === '加班餐'))
    assert.equal(ledger.removeRule('加班餐'), true)
    assert.equal(ledger.removeRule('加班餐'), false)
  })

  it('removes entries', () => {
    const { entry: e } = ledger.add({ amountText: '1', remark: 'delete-me' })
    assert.equal(ledger.remove(e.id), true)
    assert.equal(ledger.remove(e.id), false)
  })

  it('reports daily, monthly, category and trend summaries', () => {
    const daily = ledger.report('daily', { month: '2026-08' }) as { rows: import('../src/report.js').DailyRow[] }
    assert.ok(daily.rows.length >= 1)
    const monthly = ledger.report('monthly', { start: '2026-07', end: '2026-08' }) as { rows: import('../src/report.js').MonthlyRow[] }
    assert.ok(monthly.rows.some((r) => r.month === '2026-08'))
    const cat = ledger.report('category', { month: '2026-08' }) as { rows: import('../src/report.js').CategoryRow[] }
    assert.ok(cat.rows.some((r) => r.category === '餐饮'))
    const trend = ledger.report('trend', { months: 3 }) as { rows: import('../src/report.js').TrendRow[] }
    assert.equal(trend.rows.length, 3)
    assert.equal(trend.rows[trend.rows.length - 1].month, '2026-08')
  })

  it('rejects invalid report parameters', () => {
    assert.throws(() => ledger.report('bogus' as never), /report kind/i)
    assert.throws(() => ledger.report('trend', { months: 0 }), /months/i)
    assert.throws(() => ledger.report('trend', { months: 25 }), /months/i)
    assert.throws(() => ledger.report('monthly', { start: 'not-a-date' }), /start/i)
    assert.throws(() => ledger.list({ start: 'bad' }), /start/i)
    assert.throws(() => ledger.list({ type: 'transfer' as never }), /type/i)
    // Calendar-validated bounds
    assert.throws(() => ledger.list({ end: '2026-13' }), /end/i)
    assert.throws(() => ledger.list({ end: '2026-02-30' }), /end/i)
    assert.throws(() => ledger.report('monthly', { start: '2026-13' }), /start/i)
  })

  it('expands month bounds on list/export filters', () => {
    const { entries } = ledger.list({ start: '2026-07', end: '2026-08' })
    assert.ok(entries.every((e) => e.date >= '2026-07-01' && e.date <= '2026-08-31'))
    assert.ok(entries.length >= 1)
  })

  it('normalizes category filters', () => {
    const { entries } = ledger.list({ category: '餐饮 ' })
    assert.ok(entries.every((e) => e.category === '餐饮'))
    assert.ok(entries.length >= 1)
  })

  it('tolerates NaN limits (clamped, not thrown)', () => {
    const { entries } = ledger.list({ limit: Number.NaN })
    assert.ok(entries.length >= 1)
  })

  it('applies the configured default currency to symbol-less amounts', () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'dsh-bk-ledger4-'))
    const store4 = new BookkeepingStore(dir4)
    const ledgerUsd = new Ledger({ store: store4, now: () => NOW, defaultCurrency: 'USD' })
    try {
      const { entry: plain } = ledgerUsd.add({ amountText: '35', remark: 'x' })
      assert.equal(plain.currency, 'USD')
      assert.equal(plain.amountCents, 3500)
      // A symbol still wins over the configured default.
      const { entry: symbol } = ledgerUsd.add({ amountText: '¥35', remark: 'y' })
      assert.equal(symbol.currency, 'CNY')
      // An explicit argument wins too, and is normalized.
      const { entry: explicit } = ledgerUsd.add({ amountText: '35', remark: 'z', currency: 'jpy' })
      assert.equal(explicit.currency, 'JPY')
    } finally {
      store4.close()
      rmSync(dir4, { recursive: true, force: true })
    }
  })

  it('rejects an invalid configured default currency at construction', () => {
    const dir5 = mkdtempSync(join(tmpdir(), 'dsh-bk-ledger5-'))
    const store5 = new BookkeepingStore(dir5)
    try {
      assert.throws(() => new Ledger({ store: store5, defaultCurrency: '=2+5' }), /currency/i)
    } finally {
      store5.close()
      rmSync(dir5, { recursive: true, force: true })
    }
  })

  it('ignores a month filter for trend (window defines its own range)', () => {
    // A July entry distinguishes the fixed behavior: with the month filter
    // stripped, July data appears inside the 3-month window.
    ledger.add({ amountText: '7', remark: '七月', date: '2026-07-15' })
    const trend = ledger.report('trend', { months: 3, month: '2026-08' }) as { rows: import('../src/report.js').TrendRow[] }
    assert.equal(trend.rows.length, 3)
    assert.equal(trend.rows[0].month, '2026-06')
    assert.equal(trend.rows[0].expenseCents, 0)
    assert.equal(trend.rows[1].month, '2026-07')
    assert.equal(trend.rows[1].expenseCents, 700)
    assert.equal(trend.rows[2].month, '2026-08')
  })

  it('clamps list limits', () => {
    const { entries: capped } = ledger.list({ limit: 500 })
    assert.ok(capped.length <= 200)
    const { entries: atLeastOne } = ledger.list({ limit: 0 })
    assert.equal(atLeastOne.length, 1)
  })

  it('exports entries to files', () => {
    const outDir = join(dir, 'exports')
    const csv = ledger.exportEntries({ month: '2026-08' }, 'csv', outDir)
    assert.ok(csv.count > 0)
    assert.ok(csv.path.endsWith('.csv'))
    const html = ledger.exportEntries({ month: '2026-08' }, 'html', outDir)
    assert.ok(html.path.endsWith('.html'))
  })
})
