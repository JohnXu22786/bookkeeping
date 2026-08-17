/** Built-in categories and keyword auto-categorization. */

import { LedgerError } from './types.js'

export type CategoryKind = 'expense' | 'income' | 'both'

export interface CategoryInfo {
  name: string
  kind: CategoryKind
  keywords: readonly string[]
}

export const DEFAULT_CATEGORY = '其他'

/**
 * Built-in categories. Order matters: when two keywords of the same length
 * match, the earlier category wins.
 */
export const BUILTIN_CATEGORIES: readonly CategoryInfo[] = [
  {
    name: '餐饮',
    kind: 'expense',
    keywords: ['早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '夜宵', '外卖', '咖啡', 'coffee', '奶茶', '火锅', '烧烤', '食堂', '餐厅', '饭', '面', '米线', '快餐', '零食', '水果', '甜点', '面包', '啤酒', '饮料', 'lunch', 'dinner', 'breakfast', 'tea'],
  },
  {
    name: '交通',
    kind: 'expense',
    keywords: ['地铁', '公交', '打车', '出租车', '滴滴', '高铁', '火车', '飞机', '机票', '加油', '停车', '充电', '单车', '共享单车', '车票', 'taxi', 'uber', 'bus', 'subway', 'train', 'flight', 'airfare'],
  },
  {
    name: '购物',
    kind: 'expense',
    keywords: ['淘宝', '京东', '拼多多', '超市', '衣服', '鞋', '裤', '包', '快递', '电商', '购物', '日用', '化妆品', '护肤品', '手机', '数码', 'shopping', 'amazon'],
  },
  {
    name: '居住',
    kind: 'expense',
    keywords: ['房租', '水电', '水费', '电费', '燃气', '物业', '网费', '宽带', '房贷', '维修', '家具', 'rent'],
  },
  {
    name: '娱乐',
    kind: 'expense',
    keywords: ['电影', '游戏', '旅游', '门票', 'ktv', '唱歌', '健身', '运动', '会员', '视频', '音乐', '演出', '展览', '景区', '酒店', '娱乐', 'movie', 'game'],
  },
  {
    name: '医疗',
    kind: 'expense',
    keywords: ['药', '医院', '挂号', '门诊', '体检', '牙', '看病', '诊所', '药店', '疫苗', '手术', 'hospital', 'doctor', 'medicine'],
  },
  {
    name: '学习',
    kind: 'expense',
    keywords: ['书', '课程', '培训', '学费', '网课', '教材', '考试', '报名费', '文具', 'book', 'course'],
  },
  {
    name: '收入',
    kind: 'income',
    keywords: ['工资', '奖金', '兼职', '报销', '退款', '红包', '利息', '分红', '理财', '稿费', '年终奖', '补贴', '劳务费', 'salary', 'bonus', 'refund'],
  },
  { name: DEFAULT_CATEGORY, kind: 'both', keywords: [] },
]

/** A custom keyword → category rule (from the database). */
export interface RuleLike {
  keyword: string
  category: string
}

export interface CategorizeResult {
  category: string
  matched: boolean
  keyword: string | null
}

/**
 * Auto-categorize free text. Custom rules are consulted alongside built-in
 * keywords; the longest matching keyword wins, ties go to custom rules, and
 * the default category is returned when nothing matches. Matching is
 * case-insensitive substring matching.
 */
export function categorize(text: string, rules: readonly RuleLike[] = []): CategorizeResult {
  const hay = text.toLowerCase()
  if (!hay) return { category: DEFAULT_CATEGORY, matched: false, keyword: null }

  let best: { keyword: string; category: string; isRule: boolean } | null = null
  const consider = (keyword: string, category: string, isRule: boolean): void => {
    const kw = keyword.toLowerCase()
    if (!kw || !hay.includes(kw)) return
    if (
      best === null
      || kw.length > best.keyword.length
      || (kw.length === best.keyword.length && isRule && !best.isRule)
    ) {
      best = { keyword: kw, category, isRule }
    }
  }

  for (const rule of rules) consider(rule.keyword, rule.category, true)
  for (const cat of BUILTIN_CATEGORIES) {
    for (const kw of cat.keywords) consider(kw, cat.name, false)
  }

  if (best === null) return { category: DEFAULT_CATEGORY, matched: false, keyword: null }
  // TS control-flow analysis cannot track closure assignments; alias the value.
  const winner = best as { keyword: string; category: string }
  return { category: winner.category, matched: true, keyword: winner.keyword }
}

/** Normalize a category name: trim, strip control characters, enforce limits. */
export function normalizeCategory(name: string): string {
  const s = String(name).trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (!s) throw new LedgerError('Invalid category: name is empty')
  if (s.length > 50) throw new LedgerError('Invalid category: name too long (max 50 characters)')
  return s
}

/** All known category names: built-ins plus categories used by custom rules. */
export function categoryNames(rules: readonly RuleLike[]): string[] {
  const names: string[] = []
  for (const cat of BUILTIN_CATEGORIES) names.push(cat.name)
  for (const rule of rules) {
    if (!names.includes(rule.category)) names.push(rule.category)
  }
  return names
}

/** Kind of a built-in category (undefined for categories introduced by rules). */
export function categoryKind(name: string): CategoryKind | undefined {
  return BUILTIN_CATEGORIES.find((cat) => cat.name === name)?.kind
}

/** Whether a name is a built-in category or one introduced by a rule. */
export function isKnownCategory(name: string, rules: readonly RuleLike[]): boolean {
  return categoryNames(rules).includes(name)
}
