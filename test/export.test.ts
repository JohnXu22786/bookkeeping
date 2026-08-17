import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BookkeepingStore } from '../src/store.js'
import { toCsv, toHtml, exportEntries } from '../src/export.js'
import type { Entry } from '../src/types.js'

describe('export', () => {
  let dir: string
  let store: BookkeepingStore

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-export-'))
    store = new BookkeepingStore(dir)
    store.addEntry({ amountCents: 3550, currency: 'CNY', type: 'expense', category: '餐饮', remark: '午饭', tags: ['a', 'b'], date: '2026-08-17', createdAt: '2026-08-17T04:00:00.000Z' })
    store.addEntry({ amountCents: 100000, currency: 'CNY', type: 'income', category: '收入', remark: '工资', tags: [], date: '2026-08-10', createdAt: '2026-08-10T04:00:00.000Z' })
  })
  after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('toCsv escapes commas, quotes and newlines', () => {
    const tricky: Entry = {
      id: 99,
      amountCents: 100,
      currency: 'CNY',
      type: 'expense',
      category: '餐饮',
      remark: 'a,"b",c\nline2',
      tags: ['x'],
      date: '2026-08-01',
      createdAt: '',
    }
    const csv = toCsv([tricky])
    const body = csv.replace(/^\uFEFF/, '')
    const lines = body.trimEnd().split('\n')
    assert.equal(lines.length, 3) // header + two fragments of the multi-line row
    assert.ok(lines[0].startsWith('id,date,type,category,remark,tags,currency,amount'))
    const dataLine = lines.slice(1).join('\n')
    // remark must be quoted and inner quotes doubled
    assert.ok(dataLine.includes('"a,""b"",c\nline2"'), `got: ${dataLine}`)
    assert.ok(dataLine.includes(',x,'))
    assert.ok(dataLine.endsWith(',CNY,1.00'))
  })

  it('toCsv starts with a UTF-8 BOM for spreadsheet compatibility', () => {
    assert.ok(toCsv([]).startsWith('\uFEFF'))
  })

  it('toCsv quotes fields that start with spreadsheet formula triggers', () => {
    const rows: Entry[] = [
      { id: 1, amountCents: 100, currency: '=2+5', type: 'expense', category: '餐饮', remark: '=SUM(A1)', tags: [], date: '2026-08-01', createdAt: '' },
      { id: 2, amountCents: 100, currency: 'CNY', type: 'expense', category: '其他', remark: '-1+1', tags: ['+标签'], date: '2026-08-02', createdAt: '' },
      { id: 3, amountCents: 100, currency: 'CNY', type: 'expense', category: '其他', remark: '@cmd', tags: [], date: '2026-08-03', createdAt: '' },
    ]
    const csv = toCsv(rows)
    assert.ok(csv.includes('"=SUM(A1)"'))
    assert.ok(csv.includes('"-1+1"'))
    assert.ok(csv.includes('"+标签"'))
    assert.ok(csv.includes('"@cmd"'))
    // the currency column is hardened too (defense in depth)
    assert.ok(csv.includes('"=2+5"'))
  })

  it('toCsv renders one row per entry with decimal amounts', () => {
    const csv = toCsv(store.listEntries())
    const lines = csv.trimEnd().split('\n')
    assert.equal(lines.length, 3)
    assert.ok(lines[1].includes(',午饭,'))
    assert.ok(lines[1].endsWith(',CNY,35.50'))
  })

  it('toHtml escapes HTML in remarks and includes summary data', () => {
    store.addEntry({ amountCents: 1, currency: 'CNY', type: 'expense', category: '其他', remark: '<script>alert(1)</script> & "quotes"', tags: [], date: '2026-08-18', createdAt: '' })
    const html = toHtml(store.listEntries(), { title: '测试报表', expenseCents: 3551, incomeCents: 100000 })
    assert.ok(html.includes('<meta charset="utf-8">'))
    assert.ok(html.includes('<table'))
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(!html.includes('<script>alert(1)</script>'))
    assert.ok(html.includes('测试报表'))
    assert.ok(html.includes('¥35.51'))
    assert.ok(html.includes('¥1,000.00'))
  })

  it('toHtml renders summary cards in the requested currency', () => {
    const html = toHtml([], { title: 't', expenseCents: 3500, incomeCents: 0, currency: 'USD' })
    assert.ok(html.includes('$35.00'))
    const byDefault = toHtml([], { expenseCents: 3500 })
    assert.ok(byDefault.includes('¥35.00'))
  })

  it('exportEntries writes files with the requested extension', () => {
    const out = join(dir, 'exports')
    const csv = exportEntries(store, { month: '2026-08' }, 'csv', out)
    assert.ok(csv.count > 0)
    assert.ok(csv.path.endsWith('.csv'))
    assert.ok(existsSync(csv.path))
    const html = exportEntries(store, { month: '2026-08' }, 'html', out)
    assert.ok(html.path.endsWith('.html'))
    assert.ok(existsSync(html.path))
    assert.ok(readFileSync(csv.path, 'utf8').includes('id,date,type'))
  })

  it('exportEntries exports more than the interactive page size', () => {
    const big = mkdtempSync(join(tmpdir(), 'dsh-bk-export-big-'))
    const bigStore = new BookkeepingStore(big)
    try {
      for (let i = 0; i < 60; i += 1) {
        bigStore.addEntry({ amountCents: 100, currency: 'CNY', type: 'expense', category: '其他', remark: `e${i}`, tags: [], date: '2026-03-01', createdAt: '' })
      }
      const result = exportEntries(bigStore, {}, 'csv', join(dir, 'exports'))
      assert.equal(result.count, 60)
      const lines = readFileSync(result.path, 'utf8').trimEnd().split('\n')
      assert.equal(lines.length, 61) // header + 60 rows
    } finally {
      bigStore.close()
      rmSync(big, { recursive: true, force: true })
    }
  })
})
