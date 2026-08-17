/**
 * dsh-bookkeeping — conversational bookkeeping plugin for DeepSeek Harness.
 *
 * Records expenses/income from chat, answers ledger queries, runs reports,
 * exports CSV/HTML, and tracks monthly budgets.
 *
 * Bundle entry: exports the plugin contract (name / inject / Config / apply).
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Ledger } from './ledger.js'
import { DEFAULT_MAX_UNITS, normalizeCurrency } from './money.js'
import { resolveDataDir } from './paths.js'
import { BookkeepingStore } from './store.js'
import { registerTools } from './tools.js'

export const name = 'bookkeeping'

export const inject = ['tools']

/** Plugin configuration. Defaults are applied by the Cordis schema. */
export interface Config {
  /** Data directory for the SQLite database and exports. Defaults to ~/.dsh-bookkeeping (or $DSH_BOOKKEEPING_DATA_DIR). */
  dataDir?: string
  /** Default currency for amounts without a symbol. */
  currency?: string
  /** Maximum accepted amount in units (default 1,000,000,000,000). */
  maxAmount?: number
}

/** Runtime configuration schema (Schemastery). */
export const Config: z<Config> = z.object({
  dataDir: z.string(),
  currency: z.string().default('CNY'),
  maxAmount: z.number().default(DEFAULT_MAX_UNITS),
})

export function apply(ctx: Context, config: Config = {}): void {
  const dataDir = resolveDataDir(config.dataDir)
  const store = new BookkeepingStore(dataDir)
  ctx.effect(() => () => {
    try {
      store.close()
    } catch {
      // The store may already be closed by an earlier teardown.
    }
  })
  const ledger = new Ledger({
    store,
    defaultCurrency: config.currency,
    maxUnits: config.maxAmount,
  })
  registerTools(ctx, {
    ledger,
    dataDir,
    defaultCurrency: normalizeCurrency(config.currency) ?? 'CNY',
  })
}
