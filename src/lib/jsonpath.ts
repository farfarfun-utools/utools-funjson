import { paths, query, type JsonValue } from 'jsonpath-rfc9535'
import { parseJsonLike } from './formats'

export interface JsonPathResult {
  results: unknown[]
  paths: string[]
  count: number
  formatted: string
  error?: string
}

export interface JsonPathExample {
  id: string
  expression: string
  titleZh: string
  titleEn: string
  descZh: string
  descEn: string
}

export const JSONPATH_EXAMPLES: JsonPathExample[] = [
  {
    id: 'all-names',
    expression: '$.users[*].name',
    titleZh: '提取所有用户名',
    titleEn: 'All user names',
    descZh: '遍历 users 数组并获取每个对象的 name 字段',
    descEn: 'Iterate over users array and extract each name field',
  },
  {
    id: 'filter-active',
    expression: '$.users[?@.active == true]',
    titleZh: '筛选活跃用户',
    titleEn: 'Filter active users',
    descZh: '使用 RFC 9535 过滤表达式匹配 active 为 true 的项',
    descEn: 'Filter items where active equals true using RFC 9535 syntax',
  },
  {
    id: 'recursive-descendant',
    expression: '$..id',
    titleZh: '递归查找所有 id',
    titleEn: 'Recursive id search',
    descZh: '跨任意嵌套层级提取全部 id 字段值',
    descEn: 'Find every id property across all nested levels',
  },
  {
    id: 'array-slice',
    expression: '$.users[0:2]',
    titleZh: '数组切片前 2 项',
    titleEn: 'First 2 users slice',
    descZh: '按起止下标截取数组中的前两条记录',
    descEn: 'Slice the first two elements from the users array',
  },
  {
    id: 'numeric-compare',
    expression: '$.users[?@.score >= 90].name',
    titleZh: '高分用户姓名',
    titleEn: 'High-score user names',
    descZh: '结合数值比较条件与链式属性提取',
    descEn: 'Combine numeric filter predicate with property projection',
  },
  {
    id: 'nested-tags',
    expression: '$.users[*].tags[*]',
    titleZh: '展平所有标签',
    titleEn: 'Flatten all tags',
    descZh: '跨多层数组通配符展平全部标签值',
    descEn: 'Flatten nested tag arrays using chained wildcards',
  },
]

export function runJsonPath(input: string, expression: string): JsonPathResult {
  const expr = expression.trim()
  if (!expr) {
    return {
      results: [],
      paths: [],
      count: 0,
      formatted: '[]',
      error: 'JSONPath expression is required',
    }
  }

  let parsed: unknown
  try {
    parsed = parseJsonLike(input)
  } catch (err) {
    return {
      results: [],
      paths: [],
      count: 0,
      formatted: '[]',
      error: err instanceof Error ? err.message : 'Invalid JSON input',
    }
  }

  try {
    const results = query(parsed as JsonValue, expr)
    const matchedPaths = paths(parsed as JsonValue, expr)
    return {
      results,
      paths: matchedPaths,
      count: results.length,
      formatted: JSON.stringify(results, null, 2),
    }
  } catch (err) {
    return {
      results: [],
      paths: [],
      count: 0,
      formatted: '[]',
      error: err instanceof Error ? err.message : 'Invalid JSONPath expression',
    }
  }
}
