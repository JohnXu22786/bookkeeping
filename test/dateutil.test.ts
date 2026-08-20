import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDate, formatDate, toMonth, currentMonth, monthRange, addMonths } from '../src/dateutil.js'

// 2026-08-17 is a Monday.
const NOW = new Date(2026, 7, 17, 12, 0, 0)

describe('parseDate', () => {
  it('parses absolute date formats', () => {
    assert.equal(parseDate('2026-08-17', NOW), '2026-08-17')
    assert.equal(parseDate('2026/8/17', NOW), '2026-08-17')
    assert.equal(parseDate('2026.8.17', NOW), '2026-08-17')
    assert.equal(parseDate('2026年8月17日', NOW), '2026-08-17')
    assert.equal(parseDate('2026-8-7', NOW), '2026-08-07')
    assert.equal(parseDate('8/17', NOW), '2026-08-17')
    assert.equal(parseDate('8月17日', NOW), '2026-08-17')
    assert.equal(parseDate('3月5日', NOW), '2026-03-05')
    assert.equal(parseDate('12月31日', NOW), '2026-12-31')
  })

  it('parses relative day words', () => {
    assert.equal(parseDate('今天', NOW), '2026-08-17')
    assert.equal(parseDate('今日', NOW), '2026-08-17')
    assert.equal(parseDate('today', NOW), '2026-08-17')
    assert.equal(parseDate('昨天', NOW), '2026-08-16')
    assert.equal(parseDate('昨日', NOW), '2026-08-16')
    assert.equal(parseDate('yesterday', NOW), '2026-08-16')
    assert.equal(parseDate('前天', NOW), '2026-08-15')
    assert.equal(parseDate('明天', NOW), '2026-08-18')
    assert.equal(parseDate('后天', NOW), '2026-08-19')
  })

  it('maps weekday words into the current Monday-based week', () => {
    assert.equal(parseDate('周一', NOW), '2026-08-17')
    assert.equal(parseDate('星期一', NOW), '2026-08-17')
    assert.equal(parseDate('周三', NOW), '2026-08-19')
    assert.equal(parseDate('周5', NOW), '2026-08-21')
    assert.equal(parseDate('周日', NOW), '2026-08-23')
    assert.equal(parseDate('星期天', NOW), '2026-08-23')
    assert.equal(parseDate('礼拜六', NOW), '2026-08-22')
  })

  it('parses last/next week weekday forms', () => {
    assert.equal(parseDate('上周一', NOW), '2026-08-10')
    assert.equal(parseDate('上个周日', NOW), '2026-08-16')
    assert.equal(parseDate('下周天', NOW), '2026-08-30')
    assert.equal(parseDate('上周', NOW), '2026-08-10')
    assert.equal(parseDate('下周', NOW), '2026-08-24')
  })

  it('parses N-days/weeks/months before/after', () => {
    assert.equal(parseDate('3天前', NOW), '2026-08-14')
    assert.equal(parseDate('5天后', NOW), '2026-08-22')
    assert.equal(parseDate('1周前', NOW), '2026-08-10')
    assert.equal(parseDate('2周后', NOW), '2026-08-31')
    assert.equal(parseDate('1个月前', NOW), '2026-07-17')
    assert.equal(parseDate('2个月后', NOW), '2026-10-17')
    assert.equal(parseDate('3月前', NOW), '2026-05-17')
  })

  it('parses month words and clamps day-of-month to month length', () => {
    assert.equal(parseDate('上个月', NOW), '2026-07-17')
    assert.equal(parseDate('本月', NOW), '2026-08-17')
    assert.equal(parseDate('这个月', NOW), '2026-08-17')
    assert.equal(parseDate('下个月', NOW), '2026-09-17')
    assert.equal(parseDate('3月', NOW), '2026-03-17')
    // now = 2026-01-31; "2月" must clamp to 2026-02-28
    const janEnd = new Date(2026, 0, 31, 12, 0, 0)
    assert.equal(parseDate('2月', janEnd), '2026-02-28')
    assert.equal(parseDate('下个月', janEnd), '2026-02-28')
  })

  it('rejects invalid or unparseable dates', () => {
    for (const bad of ['', '  ', 'foo', 'abc', '2026-02-30', '2026-13-01', '2026-00-10', '13月', '0月5日', '2026-00-00', '周0', '0天前', '99999天后']) {
      assert.equal(parseDate(bad, NOW), null, `should reject ${JSON.stringify(bad)}`)
    }
    // 2024 is a leap year, 2026 is not
    assert.equal(parseDate('2024-02-29', NOW), '2024-02-29')
    assert.equal(parseDate('2026-02-29', NOW), null)
    assert.equal(parseDate('2月29日', NOW), null)
  })

  it('enforces the supported year range', () => {
    assert.equal(parseDate('1900-01-01', NOW), '1900-01-01')
    assert.equal(parseDate('2100-12-31', NOW), '2100-12-31')
    assert.equal(parseDate('1899-12-31', NOW), null)
    assert.equal(parseDate('2101-01-01', NOW), null)
  })

  it('trims surrounding whitespace before parsing', () => {
    assert.equal(parseDate('  2026-08-17  ', NOW), '2026-08-17')
    assert.equal(parseDate(' 今天 ', NOW), '2026-08-17')
  })
})

describe('formatDate', () => {
  it('renders zero-padded local dates', () => {
    assert.equal(formatDate(new Date(2026, 7, 17)), '2026-08-17')
    assert.equal(formatDate(new Date(2026, 0, 3)), '2026-01-03')
  })
})

describe('month helpers', () => {
  it('toMonth extracts YYYY-MM', () => {
    assert.equal(toMonth('2026-08-17'), '2026-08')
    assert.equal(toMonth('2026-01-03'), '2026-01')
  })

  it('currentMonth formats a date', () => {
    assert.equal(currentMonth(NOW), '2026-08')
  })

  it('monthRange returns inclusive bounds with correct month lengths', () => {
    assert.deepEqual(monthRange('2026-08'), { start: '2026-08-01', end: '2026-08-31' })
    assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' })
    assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' })
    assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2026-12-31' })
  })

  it('addMonths crosses year boundaries', () => {
    assert.equal(addMonths('2026-08', 1), '2026-09')
    assert.equal(addMonths('2026-12', 1), '2027-01')
    assert.equal(addMonths('2026-01', -1), '2025-12')
    assert.equal(addMonths('2026-08', 0), '2026-08')
  })
})
