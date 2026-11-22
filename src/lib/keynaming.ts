import { indentToString, parseJsonLike, type IndentOption } from './formats'

export type NamingStyle = 'camel' | 'snake' | 'pascal' | 'kebab' | 'constant' | 'dot'

export const NAMING_STYLES: Array<{ id: NamingStyle; label: string; example: string }> = [
  { id: 'camel', label: 'camelCase', example: 'userProfileId' },
  { id: 'snake', label: 'snake_case', example: 'user_profile_id' },
  { id: 'pascal', label: 'PascalCase', example: 'UserProfileId' },
  { id: 'kebab', label: 'kebab-case', example: 'user-profile-id' },
  { id: 'constant', label: 'CONSTANT_CASE', example: 'USER_PROFILE_ID' },
  { id: 'dot', label: 'dot.case', example: 'user.profile.id' },
]

export function splitWords(key: string): string[] {
  const trimmed = key.trim()
  if (!trimmed) return []

  const normalized = trimmed
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s/]+/g, ' ')
    .trim()

  return normalized
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean)
}

function capitalize(word: string): string {
  if (!word) return ''
  return word[0].toUpperCase() + word.slice(1)
}

export function convertKeyName(key: string, style: NamingStyle): string {
  const words = splitWords(key)
  if (words.length === 0) return key

  switch (style) {
    case 'camel':
      return words[0] + words.slice(1).map(capitalize).join('')
    case 'pascal':
      return words.map(capitalize).join('')
    case 'snake':
      return words.join('_')
    case 'kebab':
      return words.join('-')
    case 'constant':
      return words.map((word) => word.toUpperCase()).join('_')
    case 'dot':
      return words.join('.')
  }
}

function transformObjectKeys(
  value: unknown,
  style: NamingStyle,
  ignoreSet: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformObjectKeys(item, style, ignoreSet))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nextKey = ignoreSet.has(k) ? k : convertKeyName(k, style)
      out[nextKey] = transformObjectKeys(v, style, ignoreSet)
    }
    return out
  }
  return value
}

export function convertJsonKeys(
  input: string,
  style: NamingStyle,
  ignoreKeys: string[] = [],
  indent: IndentOption = '2',
): string {
  const parsed = parseJsonLike(input)
  const ignoreSet = new Set(ignoreKeys.map((k) => k.trim()).filter(Boolean))
  const transformed = transformObjectKeys(parsed, style, ignoreSet)
  return JSON.stringify(transformed, null, indentToString(indent))
}
