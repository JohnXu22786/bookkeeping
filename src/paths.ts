/** Data directory resolution. */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

/** Env var that overrides the data directory. */
export const ENV_DATA_DIR = 'DSH_BOOKKEEPING_DATA_DIR'

/** File name of the SQLite ledger database. */
export const DB_FILE = 'ledger.db'

/** Directory for generated exports (relative to the data dir). */
export const EXPORTS_DIR = 'exports'

/**
 * Resolve the data directory: explicit config wins, then the environment
 * variable, then ~/.dsh-bookkeeping. Creates it if missing, and returns an
 * absolute path.
 */
export function resolveDataDir(explicit?: string): string {
  const dir = explicit ?? process.env[ENV_DATA_DIR] ?? join(homedir(), '.dsh-bookkeeping')
  const absolute = resolve(dir)
  mkdirSync(absolute, { recursive: true })
  return absolute
}
