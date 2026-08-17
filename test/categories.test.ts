import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  categorize,
  normalizeCategory,
  isKnownCategory,
  categoryNames,
  DEFAULT_CATEGORY,
} from '../src/categories.js'

describe('categorize', () => {
  it('maps common remarks to built-in categories', () => {
    assert.deepEqual(categorize('午饭', []), { category: '餐饮', matched: true, keyword: '午饭' })
    assert.deepEqual(categorize('地铁票', []), { category: '交通', matched: true, keyword: '地铁' })
    assert.deepEqual(categorize('淘宝买衣服', []), { category: '购物', matched: true, keyword: '淘宝' })
    assert.deepEqual(categorize('房租', []), { category: '居住', matched: true, keyword: '房租' })
    assert.deepEqual(categorize('电影票', []), { category: '娱乐', matched: true, keyword: '电影' })
    assert.deepEqual(categorize('买药', []), { category: '医疗', matched: true, keyword: '药' })
    assert.deepEqual(categorize('买书', []), { category: '学习', matched: true, keyword: '书' })
    assert.deepEqual(categorize('工资', []), { category: '收入', matched: true, keyword: '工资' })
  })

  it('strips trailing numbers and punctuation from remarks', () => {
    assert.deepEqual(categorize('午饭 35', []), { category: '餐饮', matched: true, keyword: '午饭' })
    assert.deepEqual(categorize('午饭35元', []), { category: '餐饮', matched: true, keyword: '午饭' })
  })

  it('matches latin keywords case-insensitively', () => {
    assert.deepEqual(categorize('Coffee', []), { category: '餐饮', matched: true, keyword: 'coffee' })
    assert.deepEqual(categorize('TAXI', []), { category: '交通', matched: true, keyword: 'taxi' })
  })

  it('prefers the longest matching keyword', () => {
    // "午饭" and "饭" are both 餐饮 keywords; the longer one must win.
    assert.deepEqual(categorize('午饭', []), { category: '餐饮', matched: true, keyword: '午饭' })
  })

  it('falls back to the default category when nothing matches', () => {
    assert.deepEqual(categorize('xyz abc', []), { category: DEFAULT_CATEGORY, matched: false, keyword: null })
    assert.deepEqual(categorize('', []), { category: DEFAULT_CATEGORY, matched: false, keyword: null })
  })

  it('lets custom rules override built-in keywords', () => {
    const rules = [{ keyword: '午饭', category: '交通' }]
    assert.deepEqual(categorize('午饭', rules), { category: '交通', matched: true, keyword: '午饭' })
  })

  it('prefers the longest custom rule and then built-ins', () => {
    const rules = [
      { keyword: '咖啡', category: '娱乐' },
      { keyword: '咖啡豆', category: '购物' },
    ]
    assert.deepEqual(categorize('咖啡豆', rules), { category: '购物', matched: true, keyword: '咖啡豆' })
    assert.deepEqual(categorize('咖啡', rules), { category: '娱乐', matched: true, keyword: '咖啡' })
  })
})

describe('normalizeCategory', () => {
  it('trims and strips control characters', () => {
    assert.equal(normalizeCategory('  餐饮 '), '餐饮')
    assert.equal(normalizeCategory('a\u0000b\nc'), 'abc')
  })

  it('rejects empty or over-long names', () => {
    assert.throws(() => normalizeCategory(''), /category/i)
    assert.throws(() => normalizeCategory('   '), /category/i)
    assert.throws(() => normalizeCategory('x'.repeat(51)), /category/i)
    assert.equal(normalizeCategory('x'.repeat(50)).length, 50)
  })
})

describe('isKnownCategory / categoryNames', () => {
  it('recognizes built-in categories', () => {
    assert.equal(isKnownCategory('餐饮', []), true)
    assert.equal(isKnownCategory(DEFAULT_CATEGORY, []), true)
    assert.equal(isKnownCategory('未定义', []), false)
  })

  it('recognizes categories introduced by custom rules', () => {
    assert.equal(isKnownCategory('自定义', [{ keyword: 'a', category: '自定义' }]), true)
  })

  it('lists built-in names plus rule categories without duplicates', () => {
    const names = categoryNames([{ keyword: 'a', category: '餐饮' }, { keyword: 'b', category: '自定义' }])
    assert.ok(names.includes('餐饮'))
    assert.ok(names.includes('自定义'))
    assert.equal(names.filter((n) => n === '餐饮').length, 1)
  })
})
