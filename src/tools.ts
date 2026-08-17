/** Registration of the model-callable dsh tools. */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { budgetMessages } from './budget.js'
import { currentMonth } from './dateutil.js'
import {
  formatBudgetStatus,
  formatBudgets,
  formatCategories,
  formatCategory,
  formatDaily,
  formatEntryLine,
  formatList,
  formatMonthly,
  formatRules,
  formatTrend,
} from './format.js'
import type { Ledger } from './ledger.js'
import { formatCents } from './money.js'
import { EXPORTS_DIR } from './paths.js'
import { LedgerError, type EntryFilter, type EntryType } from './types.js'

/** JSON-serializable value accepted by the dsh tools output contract. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface ToolDeps {
  ledger: Ledger
  dataDir: string
  defaultCurrency: string
}

/** Shared output shape: a human summary plus structured data for the model. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', required: true },
    data: { type: 'json' },
  },
} as const

function render(_args: unknown, value: { summary: string }): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: value.summary }]
}

const TYPE_ENUM = ['expense', 'income'] as const
const REPORT_KINDS = ['daily', 'monthly', 'category', 'trend'] as const

interface ToolResult {
  summary: string
  data: JsonValue
}

/**
 * Tool data is always plain JSON at runtime (entries, rows, …); the cast only
 * bridges TypeScript's interface-vs-index-signature rule at the boundary.
 */
function ok(data: unknown, summary: string): ToolResult {
  return { summary, data: data as JsonValue }
}

/** Wrap every execute with an abort check; errors propagate as tool failures. */
async function guarded(exec: ToolExecution, fn: () => ToolResult): Promise<ToolResult> {
  if (exec.signal.aborted) throw new Error('tool call aborted')
  return fn()
}

function toFilter(args: {
  month?: string
  start?: string
  end?: string
  category?: string
  type?: EntryType
  tag?: string
  limit?: number
}): EntryFilter {
  return {
    month: args.month,
    start: args.start,
    end: args.end,
    category: args.category,
    type: args.type,
    tag: args.tag,
    limit: args.limit,
  }
}

export function registerTools(ctx: Context, deps: ToolDeps): void {
  const { ledger, dataDir, defaultCurrency } = deps

  ctx.tools.register(defineTool({
    name: 'bookkeeping_add',
    description: 'Record one ledger entry. Amount is required; category is optional and auto-detected from the remark when omitted. Examples: "记一笔 午饭 35" -> amount "35", remark "午饭"; income: "工资到账 5000" -> type "income", category "收入". Returns the stored entry and any budget warnings.',
    parameters: {
      amount: {
        type: 'string',
        required: true,
        description: 'Amount as text, e.g. "35", "35.5", "¥35", "35元", "$35.99", "1,234.56". Must be a positive number; the leading symbol or 元/块/円 suffix selects the currency (¥ -> CNY, $ -> USD, € -> EUR, £ -> GBP, ₩ -> KRW, 円 -> JPY).',
      },
      remark: { type: 'string', description: 'What the money was for, e.g. "午饭", "地铁". Used for auto-categorization.' },
      type: { type: 'string', enum: TYPE_ENUM, description: 'expense (default) or income.' },
      category: {
        type: 'string',
        description: 'Category name; omit to auto-detect from the remark. Known categories: 餐饮, 交通, 购物, 居住, 娱乐, 医疗, 学习, 收入, 其他 (custom categories are allowed too).',
      },
      currency: { type: 'string', description: 'ISO currency code (CNY, USD, JPY, ...). Defaults to the symbol in the amount or the configured default.' },
      date: {
        type: 'string',
        description: 'Entry date; defaults to today. Accepts "2026-08-17", "2026/8/17", "8月17日", "3月", or natural terms: 今天/昨天/前天/明天, 周X (this week), 上周X/下周X, N天前/N天后, 上个月/本月/下个月.',
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags, e.g. ["工作", "应酬"].' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const { entry, autoCategory, warnings } = ledger.add({
        amountText: args.amount,
        remark: args.remark,
        type: args.type,
        category: args.category,
        currency: args.currency,
        date: args.date,
        tags: args.tags,
      })
      const lines = [
        formatEntryLine(entry, { withId: true }),
        autoCategory ? `Category auto-detected: ${entry.category}` : '',
        ...warnings,
      ]
      return ok({ entry, autoCategory, warnings }, lines.filter(Boolean).join('\n'))
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_list',
    description: 'List ledger entries matching the filters, newest first. Use bookkeeping_report instead when you need sums: the totals line here covers only the shown page.',
    parameters: {
      month: { type: 'string', description: 'Filter by month, e.g. "2026-08".' },
      start: { type: 'string', description: 'Inclusive start bound "YYYY-MM-DD" or "YYYY-MM".' },
      end: { type: 'string', description: 'Inclusive end bound "YYYY-MM-DD" or "YYYY-MM".' },
      category: { type: 'string', description: 'Filter by category.' },
      type: { type: 'string', enum: TYPE_ENUM, description: 'Filter by expense or income.' },
      tag: { type: 'string', description: 'Filter by tag.' },
      limit: { type: 'integer', description: 'Maximum number of entries (default 50, max 200).' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const { entries, totals } = ledger.list(toFilter(args))
      return ok({ entries, totals }, formatList(entries, totals, defaultCurrency))
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_categorize',
    description: 'Predict the category for a piece of free text using built-in keywords and custom rules. Use before bookkeeping_add when unsure which category a remark belongs to.',
    parameters: {
      text: { type: 'string', required: true, description: 'The text to classify, e.g. "午饭", "打车去机场".' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const result = ledger.categorize(args.text)
      const line = result.matched
        ? `"${args.text}" -> ${result.category} (matched keyword "${result.keyword}")`
        : `"${args.text}" -> ${result.category} (no rule matched)`
      return ok({ text: args.text, ...result }, line)
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_categories',
    description: 'List all known categories (built-in plus custom rule categories) with their kind. Useful before classifying a remark.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (_args, exec) => guarded(exec, () => {
      const { builtin, rules } = ledger.categories()
      return ok({ builtin, rules }, formatCategories(builtin, rules))
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_report',
    description: 'Aggregate the ledger. Kinds: "daily" (per-day totals), "monthly" (per-month totals with net), "category" (per-category totals with share), "trend" (monthly totals for the last N months). Answer questions like "花了多少钱在餐饮上" with kind "category" + category "餐饮", or "这个月花了多少" with kind "monthly" + month. Income is included unless type "expense" is passed.',
    parameters: {
      kind: { type: 'string', required: true, enum: REPORT_KINDS, description: 'Which aggregation to run.' },
      month: { type: 'string', description: 'Restrict to a month, e.g. "2026-08".' },
      start: { type: 'string', description: 'Inclusive start "YYYY-MM-DD" or "YYYY-MM".' },
      end: { type: 'string', description: 'Inclusive end "YYYY-MM-DD" or "YYYY-MM".' },
      category: { type: 'string', description: 'Restrict to a category.' },
      type: { type: 'string', enum: ['expense', 'income', 'all'], description: 'Expense, income, or both (default both).' },
      months: { type: 'integer', description: 'For kind "trend": how many months back to include (default 6, max 24).' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const result = ledger.report(args.kind, {
        month: args.month,
        start: args.start,
        end: args.end,
        category: args.category,
        type: args.type,
        months: args.months,
      })
      const rows = result.rows as never
      let text: string
      if (result.kind === 'daily') text = formatDaily(rows, defaultCurrency)
      else if (result.kind === 'monthly') text = formatMonthly(rows, defaultCurrency)
      else if (result.kind === 'category') text = formatCategory(rows, defaultCurrency)
      else text = formatTrend(rows, defaultCurrency)
      return ok({ kind: result.kind, rows: result.rows }, text)
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_export',
    description: 'Export entries to a CSV or HTML file on disk and return the absolute file path. The whole matching set is exported. The file is written under the plugin data directory (<dataDir>/exports).',
    parameters: {
      format: { type: 'string', required: true, enum: ['csv', 'html'], description: 'Export format.' },
      month: { type: 'string', description: 'Restrict to a month, e.g. "2026-08".' },
      start: { type: 'string', description: 'Inclusive start bound "YYYY-MM-DD" or "YYYY-MM".' },
      end: { type: 'string', description: 'Inclusive end bound "YYYY-MM-DD" or "YYYY-MM".' },
      category: { type: 'string', description: 'Restrict to a category.' },
      type: { type: 'string', enum: TYPE_ENUM, description: 'Restrict to expense or income.' },
      tag: { type: 'string', description: 'Restrict to a tag.' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const outDir = join(dataDir, EXPORTS_DIR)
      const result = ledger.exportEntries(toFilter(args), args.format, outDir)
      return ok(result, `Exported ${result.count} entry/entries to ${result.path}`)
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_budget',
    description: 'Manage monthly budgets. Actions: "set" (create or update a budget; amount "0" removes it), "list" (show budgets for a month), "check" (compare spending against the budget). Budgets are in the default currency. Setting amount "0" removes the budget.',
    parameters: {
      action: { type: 'string', required: true, enum: ['set', 'list', 'check'], description: 'What to do.' },
      month: { type: 'string', description: 'Month "YYYY-MM"; defaults to the current month.' },
      category: { type: 'string', description: 'Category for a category-scoped budget; omit for the overall budget ("*").' },
      amount: { type: 'string', description: 'For "set": the budget amount, same syntax as entry amounts, e.g. "5000", "5000元". Use "0" to remove.' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const month = args.month ?? currentMonth()
      if (args.action === 'set') {
        if (args.amount === undefined) throw new LedgerError('budget "set" requires the "amount" argument')
        const { row, removed } = ledger.setBudget({ month, category: args.category, amountText: args.amount })
        if (removed) return ok({ action: 'set', removed, row }, `Budget removed: ${month} ${args.category ?? '(overall)'}`)
        return ok({ action: 'set', removed, row }, `Budget set: ${month} ${args.category ?? '(overall)'} = ${formatCents(row!.limitCents, defaultCurrency)}`)
      }
      if (args.action === 'list') {
        const rows = ledger.budgets(month)
        return ok({ action: 'list', month, rows }, formatBudgets(rows, defaultCurrency))
      }
      const statuses = ledger.budgetStatus(month, args.category ?? '*')
      const messages = budgetMessages(statuses, defaultCurrency)
      const summary = messages.length > 0
        ? messages.join('\n')
        : `Budget check ${month}: ${formatBudgetStatus(statuses, defaultCurrency)}`
      return ok({ action: 'check', month, statuses }, summary)
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_rules',
    description: 'Manage custom keyword -> category rules for auto-categorization. Rules are checked before built-in keywords; the longest matching keyword wins. Example: "add" keyword "咖啡豆" category "购物".',
    parameters: {
      action: { type: 'string', required: true, enum: ['add', 'list', 'remove'], description: 'What to do.' },
      keyword: { type: 'string', description: 'For "add"/"remove": the keyword text.' },
      category: { type: 'string', description: 'For "add": the target category.' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      if (args.action === 'list') {
        const rules = ledger.rulesList()
        return ok({ action: 'list', rules }, formatRules(rules))
      }
      if (args.action === 'add') {
        if (args.keyword === undefined || args.category === undefined) {
          throw new LedgerError('rules "add" requires "keyword" and "category"')
        }
        const rule = ledger.addRule(args.keyword, args.category)
        return ok({ action: 'add', rule }, `Rule added: "${rule.keyword}" -> ${rule.category}`)
      }
      if (args.keyword === undefined) throw new LedgerError('rules "remove" requires "keyword"')
      const removed = ledger.removeRule(args.keyword)
      return ok(
        { action: 'remove', keyword: args.keyword, removed },
        removed ? `Rule removed: "${args.keyword}"` : `No rule found for keyword "${args.keyword}"`,
      )
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'bookkeeping_remove',
    description: 'Delete an entry by its id (e.g. to correct a mis-recorded entry).',
    parameters: {
      id: { type: 'integer', required: true, description: 'The entry id, shown as "#12" in listing output.' },
    },
    output: { schema: OUTPUT_SCHEMA, render },
    execute: (args, exec) => guarded(exec, () => {
      const removed = ledger.remove(args.id)
      return ok(
        { id: args.id, removed },
        removed ? `Entry #${args.id} removed` : `Entry #${args.id} not found`,
      )
    }),
  }))
}
