/** CSV and HTML export. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { centsToUnits, formatCents } from './money.js'
import { EXPORT_LIST_LIMIT_MAX, type BookkeepingStore } from './store.js'
import type { Entry, EntryFilter } from './types.js'

/**
 * Quote a CSV field when required: it contains a comma, quote or line break,
 * or when it starts with a spreadsheet formula trigger (= + - @).
 */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value) || /^[=+\-@]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Render entries as UTF-8 (BOM-prefixed for spreadsheet compatibility) RFC 4180-style CSV. */
export function toCsv(entries: readonly Entry[]): string {
  const header = ['id', 'date', 'type', 'category', 'remark', 'tags', 'currency', 'amount']
  const lines = [header.join(',')]
  for (const e of entries) {
    lines.push([
      e.id,
      csvField(e.date),
      e.type,
      csvField(e.category),
      csvField(e.remark),
      csvField(e.tags.join('; ')),
      csvField(e.currency),
      centsToUnits(e.amountCents, e.currency),
    ].join(','))
  }
  return `\uFEFF${lines.join('\n')}\n`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface HtmlMeta {
  title?: string
  range?: string
  expenseCents?: number
  incomeCents?: number
  /** Currency used for the summary cards (default CNY). */
  currency?: string
}

/** Render entries as a self-contained HTML report (inline CSS, no JS). */
export function toHtml(entries: readonly Entry[], meta: HtmlMeta = {}): string {
  const cardCurrency = meta.currency ?? 'CNY'
  const title = escapeHtml(meta.title ?? 'Bookkeeping Report')
  const range = meta.range ? escapeHtml(meta.range) : ''
  const expense = meta.expenseCents !== undefined ? formatCents(meta.expenseCents, cardCurrency) : ''
  const income = meta.incomeCents !== undefined ? formatCents(meta.incomeCents, cardCurrency) : ''
  const net = meta.expenseCents !== undefined && meta.incomeCents !== undefined
    ? formatCents(meta.incomeCents - meta.expenseCents, cardCurrency)
    : ''

  const rows = entries.map((e) => {
    const amount = formatCents(e.amountCents, e.currency)
    return `<tr>
  <td>${e.id}</td>
  <td>${escapeHtml(e.date)}</td>
  <td>${escapeHtml(e.type)}</td>
  <td>${escapeHtml(e.category)}</td>
  <td>${escapeHtml(e.remark)}</td>
  <td>${escapeHtml(e.tags.join(' '))}</td>
  <td>${escapeHtml(e.currency)}</td>
  <td class="${e.type}">${escapeHtml(amount)}</td>
</tr>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 2rem auto; max-width: 64rem; padding: 0 1rem; color: #1f2328; }
  h1 { font-size: 1.4rem; }
  .range { color: #656d76; margin-bottom: 1.2rem; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .card { border: 1px solid #d1d9e0; border-radius: 8px; padding: 0.6rem 1rem; min-width: 8rem; }
  .card .label { font-size: 0.75rem; color: #656d76; text-transform: uppercase; }
  .card .value { font-size: 1.15rem; font-weight: 600; }
  .card.expense .value { color: #cf222e; }
  .card.income .value { color: #1a7f37; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #d1d9e0; padding: 0.35rem 0.6rem; text-align: left; }
  th { background: #f6f8fa; }
  td.expense { color: #cf222e; }
  td.income { color: #1a7f37; }
  tr:nth-child(even) td { background: #fafbfc; }
</style>
</head>
<body>
<h1>${title}</h1>
${range ? `<p class="range">${range}</p>` : ''}
<div class="cards">
  <div class="card expense"><div class="label">Expense</div><div class="value">${expense}</div></div>
  <div class="card income"><div class="label">Income</div><div class="value">${income}</div></div>
  <div class="card"><div class="label">Net</div><div class="value">${net}</div></div>
  <div class="card"><div class="label">Entries</div><div class="value">${entries.length}</div></div>
</div>
<table>
<thead>
<tr><th>ID</th><th>Date</th><th>Type</th><th>Category</th><th>Remark</th><th>Tags</th><th>Currency</th><th>Amount</th></tr>
</thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`
}

export interface ExportResult {
  path: string
  count: number
  format: 'csv' | 'html'
}

export interface ExportOptions {
  /** Currency for the HTML summary cards (default CNY). */
  currency?: string
  title?: string
}

/** Write entries matching `filter` to a timestamped file under `outDir`.
 *  Exports the full matching set (up to EXPORT_LIST_LIMIT_MAX rows). */
export function exportEntries(
  store: BookkeepingStore,
  filter: EntryFilter,
  format: 'csv' | 'html',
  outDir: string,
  options: ExportOptions = {},
): ExportResult {
  mkdirSync(outDir, { recursive: true })
  // Exports must not be limited by the interactive page size.
  const entries = store.listEntries({ ...filter, limit: EXPORT_LIST_LIMIT_MAX }, { maxLimit: EXPORT_LIST_LIMIT_MAX })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `ledger-${stamp}.${format}`
  const path = join(outDir, name)
  const body = format === 'csv' ? toCsv(entries) : toHtml(entries, {
    title: options.title ?? 'Bookkeeping Report',
    currency: options.currency,
    range: describeRange(filter),
    expenseCents: entries.filter((e) => e.type === 'expense').reduce((a, e) => a + e.amountCents, 0),
    incomeCents: entries.filter((e) => e.type === 'income').reduce((a, e) => a + e.amountCents, 0),
  })
  writeFileSync(path, body, 'utf8')
  return { path, count: entries.length, format }
}

function describeRange(filter: EntryFilter): string {
  if (filter.month) return `Month: ${filter.month}`
  if (filter.start && filter.end) return `Range: ${filter.start} – ${filter.end}`
  if (filter.start) return `From: ${filter.start}`
  if (filter.end) return `Until: ${filter.end}`
  return 'All time'
}
