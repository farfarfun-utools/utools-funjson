import { parseJsonLike } from './formats'

export interface TableData {
  columns: string[]
  rows: Record<string, string>[]
  rawRows: Record<string, unknown>[]
  error?: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item))
}

export function isExpandableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return false
}

export function collectAllObjectKeys(objects: Record<string, unknown>[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  return columns
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function joinObjectPath(parentPath: string, key: string): string {
  if (IDENTIFIER_RE.test(key)) {
    return `${parentPath}.${key}`
  }
  return `${parentPath}[${JSON.stringify(key)}]`
}

export function joinIndexPath(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`
}

export function collectDefaultExpandedPaths(data: unknown, maxDepth = 1): string[] {
  const result: string[] = []

  function walk(node: unknown, path: string, depth: number) {
    if (isPlainObject(node)) {
      const entries = Object.entries(node)
      const isSingleWrapper = entries.length === 1 && isExpandableValue(entries[0][1])
      if (isSingleWrapper) {
        const [k, v] = entries[0]
        const nextPath = joinObjectPath(path, k)
        result.push(nextPath)
        walk(v, nextPath, depth)
        return
      }
      if (depth >= maxDepth) return
      for (const [k, v] of entries) {
        if (isExpandableValue(v)) {
          const nextPath = joinObjectPath(path, k)
          result.push(nextPath)
          walk(v, nextPath, depth + 1)
        }
      }
    } else if (Array.isArray(node)) {
      const isSingleWrapper = node.length === 1 && isExpandableValue(node[0])
      if (isSingleWrapper) {
        const nextPath = joinIndexPath(path, 0)
        result.push(nextPath)
        walk(node[0], nextPath, depth)
        return
      }
      if (depth >= maxDepth) return
      if (isObjectArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          const row = node[i]
          const rowPath = joinIndexPath(path, i)
          for (const [k, v] of Object.entries(row)) {
            if (isExpandableValue(v)) {
              const nextPath = joinObjectPath(rowPath, k)
              result.push(nextPath)
              walk(v, nextPath, depth + 1)
            }
          }
        }
      } else {
        for (let i = 0; i < node.length; i += 1) {
          const item = node[i]
          if (isExpandableValue(item)) {
            const nextPath = joinIndexPath(path, i)
            result.push(nextPath)
            walk(item, nextPath, depth + 1)
          }
        }
      }
    }
  }

  walk(data, 'root', 0)
  return result
}

export function collectAllExpandablePaths(data: unknown, maxNodes = 500): string[] {
  const result: string[] = []

  function walk(node: unknown, path: string) {
    if (result.length >= maxNodes) return
    if (isPlainObject(node)) {
      for (const [k, v] of Object.entries(node)) {
        if (result.length >= maxNodes) return
        if (isExpandableValue(v)) {
          const nextPath = joinObjectPath(path, k)
          result.push(nextPath)
          walk(v, nextPath)
        }
      }
    } else if (Array.isArray(node)) {
      if (isObjectArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          if (result.length >= maxNodes) return
          const rowPath = joinIndexPath(path, i)
          for (const [k, v] of Object.entries(node[i])) {
            if (result.length >= maxNodes) return
            if (isExpandableValue(v)) {
              const nextPath = joinObjectPath(rowPath, k)
              result.push(nextPath)
              walk(v, nextPath)
            }
          }
        }
      } else {
        for (let i = 0; i < node.length; i += 1) {
          if (result.length >= maxNodes) return
          const item = node[i]
          if (isExpandableValue(item)) {
            const nextPath = joinIndexPath(path, i)
            result.push(nextPath)
            walk(item, nextPath)
          }
        }
      }
    }
  }

  walk(data, 'root')
  return result
}

function parseTablePathSegments(path: string): Array<string | number> | null {
  if (path === 'root') return []
  if (!path.startsWith('root')) return null

  const segments: Array<string | number> = []
  let idx = 4 // after 'root'
  while (idx < path.length) {
    const ch = path[idx]
    if (ch === '.') {
      idx += 1
      let end = idx
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end += 1
      }
      if (end === idx) return null
      segments.push(path.slice(idx, end))
      idx = end
    } else if (ch === '[') {
      idx += 1
      if (path[idx] === '"') {
        let end = idx + 1
        let escaped = false
        while (end < path.length) {
          if (escaped) {
            escaped = false
          } else if (path[end] === '\\') {
            escaped = true
          } else if (path[end] === '"') {
            break
          }
          end += 1
        }
        if (end >= path.length || path[end + 1] !== ']') return null
        try {
          segments.push(JSON.parse(path.slice(idx, end + 1)) as string)
        } catch {
          return null
        }
        idx = end + 2
      } else {
        const closeIdx = path.indexOf(']', idx)
        if (closeIdx === -1) return null
        const raw = path.slice(idx, closeIdx)
        const num = Number(raw)
        if (!Number.isInteger(num) || num < 0) return null
        segments.push(num)
        idx = closeIdx + 1
      }
    } else {
      return null
    }
  }
  return segments
}

export function getNodeByTablePath(
  data: unknown,
  path: string,
): { found: boolean; value: unknown } {
  const segments = parseTablePathSegments(path)
  if (!segments) return { found: false, value: undefined }
  let current: unknown = data
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current) || seg >= current.length) {
        return { found: false, value: undefined }
      }
      current = current[seg]
    } else {
      if (!isPlainObject(current) || !(seg in current)) {
        return { found: false, value: undefined }
      }
      current = current[seg]
    }
  }
  return { found: true, value: current }
}

export function tablePathToJsonPath(path: string): string {
  if (!path || path === 'root') return '$'
  if (path.startsWith('root')) {
    return `$${path.slice(4)}`
  }
  return path.startsWith('$') ? path : `$.${path}`
}

export function matchesNestedSearch(
  keyOrIdx: string | number | null,
  value: unknown,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (keyOrIdx !== null && String(keyOrIdx).toLowerCase().includes(q)) {
    return true
  }
  if (value === null) {
    return 'null'.includes(q)
  }
  if (value === undefined) {
    return false
  }
  if (typeof value !== 'object') {
    return String(value).toLowerCase().includes(q)
  }
  if (Array.isArray(value)) {
    return value.some((item, idx) => matchesNestedSearch(idx, item, q))
  }
  return Object.entries(value as Record<string, unknown>).some(([k, v]) =>
    matchesNestedSearch(k, v, q),
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function jsonToTable(input: string): TableData {
  let parsed: unknown
  try {
    parsed = parseJsonLike(input)
  } catch (err) {
    return {
      columns: [],
      rows: [],
      rawRows: [],
      error: err instanceof Error ? err.message : 'Invalid JSON input',
    }
  }

  let rawRows: Record<string, unknown>[]
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { columns: [], rows: [], rawRows: [] }
    }
    rawRows = parsed.map((item) => (isPlainObject(item) ? item : { value: item }))
  } else if (isPlainObject(parsed)) {
    rawRows = [parsed]
  } else {
    rawRows = [{ value: parsed }]
  }

  const columns = collectAllObjectKeys(rawRows)

  const rows: Record<string, string>[] = rawRows.map((rawRow) => {
    const formatted: Record<string, string> = {}
    for (const col of columns) {
      formatted[col] = formatCell(rawRow[col])
    }
    return formatted
  })

  return { columns, rows, rawRows }
}

function escapeDelimited(cell: string, delimiter: ',' | '\t'): string {
  if (
    cell.includes(delimiter) ||
    cell.includes('"') ||
    cell.includes('\n') ||
    cell.includes('\r')
  ) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

function escapeMarkdownCell(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

export function exportTable(
  columns: string[],
  rows: Record<string, string>[],
  format: 'csv' | 'tsv' | 'markdown' | 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(rows, null, 2)
  }

  if (columns.length === 0) return ''

  if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'csv' ? ',' : '\t'
    const header = columns.map((col) => escapeDelimited(col, delimiter)).join(delimiter)
    const body = rows.map((row) =>
      columns.map((col) => escapeDelimited(row[col] ?? '', delimiter)).join(delimiter),
    )
    return [header, ...body].join('\n')
  }

  // markdown
  const header = `| ${columns.map(escapeMarkdownCell).join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row) => `| ${columns.map((col) => escapeMarkdownCell(row[col] ?? '')).join(' | ')} |`,
  )
  return [header, divider, ...body].join('\n')
}

export function exportValueAsTable(
  value: unknown,
  format: 'csv' | 'tsv' | 'markdown' | 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(value, null, 2)
  }

  if (isObjectArray(value)) {
    const columns = collectAllObjectKeys(value)
    const rows = value.map((item) => {
      const formatted: Record<string, string> = {}
      for (const col of columns) {
        formatted[col] = formatCell(item[col])
      }
      return formatted
    })
    return exportTable(columns, rows, format)
  }

  if (Array.isArray(value)) {
    const columns = ['Index', 'Value']
    const rows = value.map((item, idx) => ({
      Index: String(idx),
      Value: formatCell(item),
    }))
    return exportTable(columns, rows, format)
  }

  if (isPlainObject(value)) {
    const columns = ['Key', 'Value']
    const rows = Object.entries(value).map(([k, v]) => ({
      Key: k,
      Value: formatCell(v),
    }))
    return exportTable(columns, rows, format)
  }

  return exportTable(['Value'], [{ Value: formatCell(value) }], format)
}
