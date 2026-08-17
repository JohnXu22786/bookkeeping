/** Amount parsing and formatting. Amounts are stored as integer minor units (cents). */

import { LedgerError } from './types.js'

/** Number of decimal digits each currency supports (minor-unit exponent). */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  TWD: 2,
  JPY: 0,
  KRW: 0,
}

/** Display symbol per currency, used by formatCents. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  CNY: '¥',
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  KRW: '₩',
  HKD: 'HK$',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
  TWD: 'NT$',
}

/** Leading symbol → currency. */
const SYMBOL_TO_CURRENCY: Readonly<Record<string, string>> = {
  '¥': 'CNY',
  '￥': 'CNY',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₩': 'KRW',
}

/** Trailing unit word → currency. */
const SUFFIX_TO_CURRENCY: Readonly<Record<string, string>> = {
  '元': 'CNY',
  '块': 'CNY',
  '円': 'JPY',
}

/** Default cap on a single amount, in units (1e12). */
export const DEFAULT_MAX_UNITS = 1e12

/** Maximum length of the integer part (guards against float overflow). */
const MAX_INT_DIGITS = 16

export interface ParsedAmount {
  /** Normalized decimal units, e.g. "35.5". */
  units: string
  /** Amount as integer minor units, e.g. 3550 for 35.50 CNY. */
  cents: number
  /** Resolved currency code. */
  currency: string
}

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency] ?? 2
}

/** Normalize and validate a currency code: uppercase ISO-4217-ish, exactly 3 letters. */
export function normalizeCurrency(currency: string | undefined): string | undefined {
  if (currency === undefined) return undefined
  const code = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new LedgerError(`Invalid currency: "${currency}" (expected a 3-letter code like CNY, USD, JPY)`)
  }
  return code
}

/**
 * Parse an amount from user/model text. String-based parsing avoids floating
 * point artifacts; the result is exact integer minor units.
 *
 * Accepted shapes: "35", "35.5", "¥35", "35元", "35块", "$35.99", "1,234.56".
 * Rejects: empty input, zero, negatives, non-numeric text, malformed thousands
 * separators, fractional digits beyond the currency's exponent, amounts above
 * `maxUnits`, and symbol/currency conflicts.
 *
 * `currency` is an EXPLICIT currency and must not conflict with a symbol;
 * `defaultCurrency` is only used when the amount carries no symbol.
 */
export function parseAmount(text: string, opts: { currency?: string; defaultCurrency?: string; maxUnits?: number } = {}): ParsedAmount {
  const maxUnits = opts.maxUnits ?? DEFAULT_MAX_UNITS
  const raw = text.trim()
  if (!raw) throw new LedgerError('Invalid amount: empty input')

  const match = /^([¥￥$€£₩])?([0-9][0-9,]*)(?:\.(\d+))?([元块円])?$/.exec(raw)
  if (!match) throw new LedgerError(`Invalid amount: "${text}" is not a valid number`)

  const [, symbol, intPart, fracPart, suffix] = match
  // Thousands separators are optional, but when present they must group
  // correctly and must not have a leading zero ("0,123" is malformed).
  if (intPart.includes(',') && !/^[1-9]\d{0,2}(,\d{3})+$/.test(intPart)) {
    throw new LedgerError(`Invalid amount: "${text}" has malformed thousands separators`)
  }
  const digits = intPart.replace(/,/g, '')
  if (digits.length > MAX_INT_DIGITS) {
    throw new LedgerError(`Invalid amount: "${text}" is too large`)
  }

  const hinted = symbol ? SYMBOL_TO_CURRENCY[symbol] : suffix ? SUFFIX_TO_CURRENCY[suffix] : undefined
  const explicitCurrency = opts.currency === undefined ? undefined : normalizeCurrency(opts.currency)
  if (explicitCurrency && hinted && explicitCurrency !== hinted) {
    throw new LedgerError(
      `Invalid amount: the "${symbol ?? suffix}" symbol conflicts with currency "${explicitCurrency}"`,
    )
  }
  if (symbol && suffix && SYMBOL_TO_CURRENCY[symbol] !== SUFFIX_TO_CURRENCY[suffix]) {
    throw new LedgerError(
      `Invalid amount: the "${symbol}" symbol conflicts with the "${suffix}" suffix`,
    )
  }
  // A symbol beats the fallback default; the explicit currency beats both.
  const currency = explicitCurrency ?? hinted ?? normalizeCurrency(opts.defaultCurrency ?? 'CNY')!

  const exponent = currencyExponent(currency)
  const frac = fracPart ?? ''
  if (frac.length > exponent) {
    throw new LedgerError(
      `Invalid amount: "${text}" exceeds the precision of ${currency} (${exponent} decimal place(s))`,
    )
  }

  const cents = Number(digits + frac.padEnd(exponent, '0'))
  if (!Number.isSafeInteger(cents)) {
    throw new LedgerError(`Invalid amount: "${text}" is too large`)
  }
  if (cents <= 0) {
    throw new LedgerError(`Invalid amount: "${text}" must be a positive number`)
  }
  const unitsNumber = Number(frac ? `${digits}.${frac}` : digits)
  if (unitsNumber > maxUnits) {
    throw new LedgerError(`Invalid amount: "${text}" exceeds the maximum of ${maxUnits}`)
  }

  return { units: frac ? `${digits}.${frac}` : digits, cents, currency }
}

function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Format minor units as a human-readable amount, e.g. "¥1,234.56". */
export function formatCents(cents: number, currency: string): string {
  if (cents < 0) return `-${formatCents(-cents, currency)}`
  const exponent = currencyExponent(currency)
  const value = (cents / 10 ** exponent).toFixed(exponent)
  const [int, frac] = value.split('.')
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `
  const grouped = groupDigits(int)
  return frac === undefined ? `${symbol}${grouped}` : `${symbol}${grouped}.${frac}`
}

/** Render minor units as a plain decimal string, e.g. "1234.56" (for exports). */
export function centsToUnits(cents: number, currency: string): string {
  const exponent = currencyExponent(currency)
  return (cents / 10 ** exponent).toFixed(exponent)
}
