import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAmount, formatCents, centsToUnits, currencyExponent } from '../src/money.js'

describe('parseAmount', () => {
  it('parses plain integer and decimal amounts', () => {
    assert.deepEqual(parseAmount('35'), { units: '35', cents: 3500, currency: 'CNY' })
    assert.deepEqual(parseAmount('35.5'), { units: '35.5', cents: 3550, currency: 'CNY' })
    assert.deepEqual(parseAmount('35.50'), { units: '35.50', cents: 3550, currency: 'CNY' })
    assert.deepEqual(parseAmount('0.01'), { units: '0.01', cents: 1, currency: 'CNY' })
    assert.deepEqual(parseAmount(' 35 '), { units: '35', cents: 3500, currency: 'CNY' })
  })

  it('parses currency symbols and suffixes', () => {
    assert.deepEqual(parseAmount('¥35'), { units: '35', cents: 3500, currency: 'CNY' })
    assert.deepEqual(parseAmount('￥35'), { units: '35', cents: 3500, currency: 'CNY' })
    assert.deepEqual(parseAmount('$35.99'), { units: '35.99', cents: 3599, currency: 'USD' })
    assert.deepEqual(parseAmount('€10'), { units: '10', cents: 1000, currency: 'EUR' })
    assert.deepEqual(parseAmount('£10'), { units: '10', cents: 1000, currency: 'GBP' })
    assert.deepEqual(parseAmount('₩5000'), { units: '5000', cents: 5000, currency: 'KRW' })
    assert.deepEqual(parseAmount('100円'), { units: '100', cents: 100, currency: 'JPY' })
    assert.deepEqual(parseAmount('35元'), { units: '35', cents: 3500, currency: 'CNY' })
    assert.deepEqual(parseAmount('35块'), { units: '35', cents: 3500, currency: 'CNY' })
  })

  it('parses thousands separators and strips them', () => {
    assert.deepEqual(parseAmount('1,234.56'), { units: '1234.56', cents: 123456, currency: 'CNY' })
    assert.deepEqual(parseAmount('1,234'), { units: '1234', cents: 123400, currency: 'CNY' })
  })

  it('respects an explicit currency and its exponent', () => {
    assert.deepEqual(parseAmount('35', { currency: 'USD' }), { units: '35', cents: 3500, currency: 'USD' })
    assert.deepEqual(parseAmount('35', { currency: 'JPY' }), { units: '35', cents: 35, currency: 'JPY' })
    assert.throws(() => parseAmount('35.5', { currency: 'JPY' }), /precision|小数|fraction/i)
  })

  it('rejects symbol/currency conflicts', () => {
    assert.throws(() => parseAmount('¥35', { currency: 'USD' }), /conflict|currency/i)
    assert.throws(() => parseAmount('$35', { currency: 'CNY' }), /conflict|currency/i)
    assert.throws(() => parseAmount('$35元'), /conflict/i, '$35元 must be rejected')
    assert.throws(() => parseAmount('£35元'), /conflict/i, '£35元 must be rejected')
    // ¥ and 块 both map to CNY: no conflict.
    assert.deepEqual(parseAmount('¥35块'), { units: '35', cents: 3500, currency: 'CNY' })
  })

  it('validates explicit currency codes', () => {
    for (const bad of ['=2+5', '+1', '', 'CN', 'CNY!', '12A', ' ']) {
      assert.throws(() => parseAmount('35', { currency: bad }), /currency/i, `should reject currency ${JSON.stringify(bad)}`)
    }
    // Lowercase codes are normalized to uppercase.
    assert.deepEqual(parseAmount('35', { currency: 'usd' }), { units: '35', cents: 3500, currency: 'USD' })
  })

  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '0', '-5', '+5', '3.5.6', '1,23', '12,34', '1,2345', '35.', '.5', 'NaN', 'Infinity', '¥¥35', '35元元', '３５', '0,123']) {
      assert.throws(() => parseAmount(bad), Error, `should reject ${JSON.stringify(bad)}`)
    }
  })

  it('rejects excess decimal precision for 2-decimal currencies', () => {
    assert.throws(() => parseAmount('35.555'), /precision|小数/i)
    assert.throws(() => parseAmount('3.14159'), /precision|小数/i)
  })

  it('enforces a maximum amount', () => {
    assert.deepEqual(parseAmount('1000000000000'), { units: '1000000000000', cents: 100000000000000, currency: 'CNY' })
    assert.throws(() => parseAmount('1000000000001'), /max|too large|上限/i)
    assert.throws(() => parseAmount('1000000000000.01'), /max|too large|上限/i)
    assert.deepEqual(parseAmount('99999', { maxUnits: 100000 }), { units: '99999', cents: 9999900, currency: 'CNY' })
    assert.throws(() => parseAmount('100001', { maxUnits: 100000 }), /max|too large|上限/i)
    // Integer-safety overflow must be reported as too large, not as non-positive.
    assert.throws(() => parseAmount('9999999999999999', { maxUnits: 1e13 }), /too large/i)
  })
})

describe('formatCents', () => {
  it('formats with currency symbol and 2 decimals', () => {
    assert.equal(formatCents(3500, 'CNY'), '¥35.00')
    assert.equal(formatCents(3555, 'CNY'), '¥35.55')
    assert.equal(formatCents(1, 'USD'), '$0.01')
    assert.equal(formatCents(3500, 'ZZZ'), 'ZZZ 35.00')
  })

  it('formats zero-decimal currencies without fractions', () => {
    assert.equal(formatCents(500, 'JPY'), '¥500')
    assert.equal(formatCents(35, 'KRW'), '₩35')
  })

  it('groups thousands with a comma', () => {
    assert.equal(formatCents(123456, 'CNY'), '¥1,234.56')
    assert.equal(formatCents(100000000, 'CNY'), '¥1,000,000.00')
  })

  it('renders negative amounts with the sign before the symbol', () => {
    assert.equal(formatCents(-1500, 'CNY'), '-¥15.00')
    assert.equal(formatCents(-500, 'JPY'), '-¥500')
  })
})

describe('centsToUnits', () => {
  it('renders plain decimal strings for export', () => {
    assert.equal(centsToUnits(3500, 'CNY'), '35.00')
    assert.equal(centsToUnits(500, 'JPY'), '500')
    assert.equal(centsToUnits(1, 'USD'), '0.01')
  })
})

describe('currencyExponent', () => {
  it('defaults to 2 for unknown currencies', () => {
    assert.equal(currencyExponent('CNY'), 2)
    assert.equal(currencyExponent('JPY'), 0)
    assert.equal(currencyExponent('KRW'), 0)
    assert.equal(currencyExponent('XYZ'), 2)
  })
})
