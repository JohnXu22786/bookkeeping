import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { formatDate } from '../src/dateutil.js'
import { name as pluginName, inject, apply, Config } from '../src/index.js'

const TOOL_NAMES = [
  'bookkeeping_add',
  'bookkeeping_list',
  'bookkeeping_categorize',
  'bookkeeping_categories',
  'bookkeeping_report',
  'bookkeeping_export',
  'bookkeeping_budget',
  'bookkeeping_rules',
  'bookkeeping_remove',
]

interface RegisteredTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (args: unknown, value: unknown) => unknown[] }
  execute: (args: unknown, exec: ToolExecution) => Promise<unknown>
}

function mockCtx(cleanups: Array<() => void>) {
  const registered: RegisteredTool[] = []
  const ctx = {
    on() {},
    effect(fn: () => unknown) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
      return { dispose() {} }
    },
    tools: {
      register(def: RegisteredTool) {
        registered.push(def)
        return () => {}
      },
    },
  }
  return { ctx, registered }
}

function exec(): ToolExecution {
  return { signal: new AbortController().signal } as ToolExecution
}

async function call(registered: RegisteredTool[], name: string, args: unknown) {
  const tool = registered.find((t) => t.name === name)
  assert.ok(tool, `tool ${name} not registered`)
  return (await tool.execute(args, exec())) as { summary: string; data: any }
}

/** Local-date N-days-ago, robust across DST transitions. */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatDate(d)
}

describe('dsh plugin entry', () => {
  let dir: string
  const cleanups: Array<() => void> = []

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-tools-'))
  })
  after(() => {
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch {
        // ignore teardown errors
      }
    }
    rmSync(dir, { recursive: true, force: true })
  })

  function applyWith(dir: string) {
    const { ctx, registered } = mockCtx(cleanups)
    apply(ctx as unknown as Context, { dataDir: dir })
    return registered
  }

  it('exports the plugin contract', () => {
    assert.equal(pluginName, 'bookkeeping')
    assert.deepEqual(inject, ['tools'])
    assert.equal(typeof apply, 'function')
    // Schemastery schemas are callable functions.
    assert.equal(typeof Config, 'function')
    // The schema validates config: defaults applied, bad types rejected.
    assert.deepEqual(Config({}), { currency: 'CNY', maxAmount: 1000000000000 })
    assert.deepEqual(Config({ dataDir: '/tmp/x', currency: 'USD' }), { dataDir: '/tmp/x', currency: 'USD', maxAmount: 1000000000000 })
    assert.throws(() => Config({ dataDir: 42 } as never), /dataDir/i)
    assert.throws(() => Config({ maxAmount: 'big' } as never), /maxAmount/i)
  })

  it('registers all nine tools with descriptions, parameters and output', () => {
    const registered = applyWith(dir)
    assert.deepEqual(registered.map((t) => t.name), TOOL_NAMES)
    for (const tool of registered) {
      assert.ok(tool.description.length > 10, `${tool.name} needs a description`)
      assert.ok(typeof tool.parameters === 'object' && tool.parameters !== null)
      // defineTool normalizes the output schema: property-level `required`
      // flags are hoisted into a top-level `required` array, and the author-only
      // `json` node compiles to an unconstrained annotation.
      const schema = tool.output.schema as { type: string; properties?: Record<string, { type?: string }>; required?: string[] }
      assert.equal(schema.type, 'object')
      assert.equal(schema.properties!.summary.type, 'string')
      assert.ok(schema.required!.includes('summary'))
      assert.ok(tool.output && typeof tool.output.render === 'function')
    }
  })

  it('add accepts natural-language input and auto-categorizes', async () => {
    const registered = applyWith(dir)
    const res = await call(registered, 'bookkeeping_add', { amount: '35', remark: '午饭' })
    assert.equal(res.data.entry.category, '餐饮')
    assert.equal(res.data.entry.amountCents, 3500)
    assert.equal(res.data.entry.type, 'expense')
    assert.ok(res.summary.includes('¥35.00'))
  })

  it('add accepts income and natural-language dates', async () => {
    const registered = applyWith(dir)
    const res = await call(registered, 'bookkeeping_add', { amount: '¥500', type: 'income', category: '收入', remark: '工资', date: '昨天' })
    assert.equal(res.data.entry.type, 'income')
    assert.equal(res.data.entry.currency, 'CNY')
    assert.equal(res.data.entry.date, daysAgo(1))
  })

  it('reports invalid input as an error (thrown)', async () => {
    const registered = applyWith(dir)
    await assert.rejects(
      call(registered, 'bookkeeping_add', { amount: 'abc', remark: 'x' }),
      /amount/i,
    )
  })

  it('aborts execution when the signal is aborted', async () => {
    const registered = applyWith(dir)
    const tool = registered.find((t) => t.name === 'bookkeeping_add')!
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      tool.execute({ amount: '1', remark: 'x' }, { signal: controller.signal } as ToolExecution),
      /aborted/i,
    )
  })

  it('lists, reports, exports, budgets and rules work end to end', async () => {
    const registered = applyWith(dir)
    await call(registered, 'bookkeeping_add', { amount: '10', remark: '地铁' })
    const list = await call(registered, 'bookkeeping_list', { limit: 10 })
    assert.ok(Array.isArray(list.data.entries))
    const report = await call(registered, 'bookkeeping_report', { kind: 'category' })
    assert.ok(Array.isArray(report.data.rows))
    const categorized = await call(registered, 'bookkeeping_categorize', { text: '打车去机场' })
    assert.equal(categorized.data.category, '交通')
    const categories = await call(registered, 'bookkeeping_categories', {})
    assert.ok(categories.data.builtin.length >= 9)
    const budget = await call(registered, 'bookkeeping_budget', { action: 'set', amount: '100' })
    assert.equal(budget.data.removed, false)
    const budgetCheck = await call(registered, 'bookkeeping_budget', { action: 'check' })
    assert.ok(typeof budgetCheck.data.statuses === 'object')
    const rules = await call(registered, 'bookkeeping_rules', { action: 'add', keyword: '咖啡', category: '餐饮' })
    assert.ok(rules.summary.includes('咖啡'))
    const exported = await call(registered, 'bookkeeping_export', { format: 'csv' })
    assert.ok(exported.data.count >= 0)
    const remove = await call(registered, 'bookkeeping_remove', { id: list.data.entries[0].id })
    assert.equal(remove.data.removed, true)
  })
})
