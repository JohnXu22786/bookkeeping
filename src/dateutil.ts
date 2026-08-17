/** Natural-language date parsing and date helpers. */

const MIN_YEAR = 1900
const MAX_YEAR = 2100

const WEEKDAY_CN: Readonly<Record<string, number>> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
}

/** Render a Date as a zero-padded local YYYY-MM-DD string. */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysInMonth(year: number, month: number): number {
  // month is 1-based; day 0 of the next month is the last day of this month.
  return new Date(year, month, 0).getDate()
}

function makeDate(year: number, month: number, day: number): string | null {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null
  if (day > daysInMonth(year, month)) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dayOffset(now: Date, days: number): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

function shiftMonth(now: Date, delta: number): string | null {
  const monthIndex = now.getMonth() + delta
  const year = now.getFullYear() + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12 + 1
  const day = Math.min(now.getDate(), daysInMonth(year, month))
  return makeDate(year, month, day)
}

/** Monday (00:00 local) of the week containing `now`. */
function weekStart(now: Date): Date {
  const dow = (now.getDay() + 6) % 7 // 0 = Monday … 6 = Sunday
  const d = new Date(now)
  d.setDate(d.getDate() - dow)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Date of `weekday` (1=Mon … 7=Sun) in the week offset by `weekOffset`
 * from the current week. "周X" always resolves inside the current
 * Monday-based week (documented convention).
 */
function weekdayDate(now: Date, weekday: number, weekOffset: number): string {
  const monday = weekStart(now)
  monday.setDate(monday.getDate() + weekOffset * 7 + weekday - 1)
  return formatDate(monday)
}

function parseWeekday(ch: string): number | null {
  if (/^[1-7]$/.test(ch)) return Number(ch)
  return WEEKDAY_CN[ch] ?? null
}

/**
 * Parse natural-language date text into YYYY-MM-DD, or null when unparseable.
 *
 * Supported (relative to `now`):
 * - Absolute: 2026-08-17, 2026/8/17, 2026.8.17, 2026年8月17日, 8/17, 8月17日, 3月
 * - Day words: 今天/今日/today, 昨天/昨日/yesterday, 前天, 明天, 后天
 * - Weekdays: 周X / 星期X / 礼拜X (this Monday-based week), 上周X, 下周X, 上周/下周
 * - Offsets: N天前/后, N周前/后, N个月前/后, N月前/后
 * - Months: 上个月 / 本月 / 这个月 / 下个月 (day clamped to month length)
 */
export function parseDate(text: string, now: Date = new Date()): string | null {
  const s = text.trim()
  if (!s) return null
  const lower = s.toLowerCase()

  let m = /^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?$/.exec(s)
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]))

  m = /^(\d{1,2})[-\/.月](\d{1,2})日?$/.exec(s)
  if (m) return makeDate(now.getFullYear(), Number(m[1]), Number(m[2]))

  m = /^(\d{1,2})月$/.exec(s)
  if (m) {
    const month = Number(m[1])
    if (month < 1 || month > 12) return null
    const day = Math.min(now.getDate(), daysInMonth(now.getFullYear(), month))
    return makeDate(now.getFullYear(), month, day)
  }

  if (s === '上个月') return shiftMonth(now, -1)
  if (s === '本月' || s === '这个月') return formatDate(now)
  if (s === '下个月') return shiftMonth(now, 1)

  const relWords: Readonly<Record<string, number>> = {
    今天: 0,
    今日: 0,
    today: 0,
    昨天: -1,
    昨日: -1,
    yesterday: -1,
    前天: -2,
    明天: 1,
    明日: 1,
    tomorrow: 1,
    后天: 2,
  }
  const rel = relWords[lower]
  if (rel !== undefined) return dayOffset(now, rel)

  m = /^(周|星期|礼拜)([一二三四五六日天1-7])$/.exec(s)
  if (m) {
    const weekday = parseWeekday(m[2])
    if (weekday === null) return null
    return weekdayDate(now, weekday, 0)
  }

  m = /^(上个?周|下个?周)([一二三四五六日天1-7])$/.exec(s)
  if (m) {
    const weekday = parseWeekday(m[2])
    if (weekday === null) return null
    return weekdayDate(now, weekday, m[1].startsWith('上') ? -1 : 1)
  }

  if (s === '上周' || s === '上个周') return dayOffset(now, -7)
  if (s === '下周' || s === '下个周') return dayOffset(now, 7)

  m = /^(\d{1,4})(天|周)(前|后)$/.exec(s)
  if (m) {
    const n = Number(m[1])
    if (n < 1) return null
    const days = m[2] === '天' ? n : n * 7
    return dayOffset(now, m[3] === '前' ? -days : days)
  }

  m = /^(\d{1,3})(个月|月)(前|后)$/.exec(s)
  if (m) {
    const n = Number(m[1])
    if (n < 1) return null
    return shiftMonth(now, m[3] === '前' ? -n : n)
  }

  return null
}

/** Extract YYYY-MM from a YYYY-MM-DD date. */
export function toMonth(date: string): string {
  return date.slice(0, 7)
}

/**
 * Whether a string is a valid "YYYY-MM-DD" or "YYYY-MM" bound (calendar-checked,
 * within the supported year range).
 */
export function isValidDate(s: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return makeDate(y, m, d) !== null
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [, m] = s.split('-').map(Number)
    return m >= 1 && m <= 12
  }
  return false
}

/** Current month as YYYY-MM. */
export function currentMonth(now: Date = new Date()): string {
  return formatDate(now).slice(0, 7)
}

/** Inclusive first/last day of a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number)
  const last = daysInMonth(year, m)
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/** Add a month offset to a YYYY-MM string, crossing year boundaries. */
export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const total = year * 12 + (m - 1) + delta
  const y = Math.floor(total / 12)
  const mm = ((total % 12) + 12) % 12 + 1
  return `${y}-${String(mm).padStart(2, '0')}`
}

/**
 * Expand a filter bound: "YYYY-MM" becomes the month's first/last day,
 * anything else passes through unchanged (callers validate first).
 */
export function normalizeBound(bound: string, mode: 'start' | 'end'): string {
  return /^\d{4}-\d{2}$/.test(bound) ? monthRange(bound)[mode] : bound
}
