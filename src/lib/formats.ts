import JSON5 from 'json5'
import { jsonrepair } from 'jsonrepair'

export type DataFormat = 'json' | 'jsonc' | 'json5' | 'ndjson' | 'text'

export type IndentOption = '2' | '4' | 'tab'

export interface DataFormatMeta {
  id: DataFormat
  label: string
  shortLabel: string
  ext: string
  supportsFormat: boolean
  isJsonLike: boolean
}

export const DATA_FORMATS: DataFormatMeta[] = [
  { id: 'json', label: 'JSON', shortLabel: 'JSON', ext: 'json', supportsFormat: true, isJsonLike: true },
  { id: 'jsonc', label: 'JSONC', shortLabel: 'JSONC', ext: 'jsonc', supportsFormat: true, isJsonLike: true },
  { id: 'json5', label: 'JSON5', shortLabel: 'JSON5', ext: 'json5', supportsFormat: true, isJsonLike: true },
  { id: 'ndjson', label: 'NDJSON', shortLabel: 'NDJSON', ext: 'ndjson', supportsFormat: true, isJsonLike: false },
  { id: 'text', label: 'Plain Text', shortLabel: 'TXT', ext: 'txt', supportsFormat: false, isJsonLike: false },
]

const EXT_TO_FORMAT: Record<string, DataFormat> = {
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  ndjson: 'ndjson',
  jsonl: 'ndjson',
  txt: 'text',
}

export function getFormatMeta(format: DataFormat): DataFormatMeta {
  return DATA_FORMATS.find((item) => item.id === format) ?? DATA_FORMATS[0]
}

export function indentToString(indent: IndentOption): string {
  if (indent === 'tab') return '\t'
  if (indent === '4') return '    '
  return '  '
}

function looksLikeNdjson(trimmed: string): boolean {
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return false
  for (const line of lines.slice(0, 20)) {
    if (!(line.startsWith('{') || line.startsWith('['))) return false
    try {
      const parsed = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object') return false
    } catch {
      return false
    }
  }
  return true
}

function hasJsonComments(input: string): boolean {
  let inString: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === inString) {
        inString = null
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
      continue
    }
    if (ch === '/' && (next === '/' || next === '*')) {
      return true
    }
  }
  return false
}

export function stripJsonComments(input: string): string {
  let out = ''
  let inString: '"' | "'" | null = null
  let escaped = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === inString) {
        inString = null
      }
      i += 1
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = ch
      out += ch
      i += 1
      continue
    }

    if (ch === '/' && next === '/') {
      i += 2
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') {
        i += 1
      }
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < input.length) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i += 2
          break
        }
        if (input[i] === '\n') {
          out += '\n'
        }
        i += 1
      }
      continue
    }

    out += ch
    i += 1
  }

  return out
}

export function detectFormat(content: string, filename?: string): DataFormat {
  if (filename) {
    const base = filename.split(/[/\\]/).pop() ?? filename
    const dotIndex = base.lastIndexOf('.')
    if (dotIndex > 0 && dotIndex < base.length - 1) {
      const ext = base.slice(dotIndex + 1).toLowerCase()
      const matched = EXT_TO_FORMAT[ext]
      if (matched) return matched
    }
  }

  const trimmed = content.trim()
  if (!trimmed) return 'json'

  // NDJSON (check before single JSON)
  if (looksLikeNdjson(trimmed)) {
    return 'ndjson'
  }

  // JSON / JSONC / JSON5
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // continue to JSONC / JSON5 checks
    }
    if (hasJsonComments(trimmed)) {
      try {
        JSON.parse(stripJsonComments(trimmed))
        return 'jsonc'
      } catch {
        // continue
      }
    }
    try {
      JSON5.parse(trimmed)
      return hasJsonComments(trimmed) ? 'jsonc' : 'json5'
    } catch {
      // continue
    }
  } else if (hasJsonComments(trimmed)) {
    const stripped = stripJsonComments(trimmed).trim()
    if (stripped.startsWith('{') || stripped.startsWith('[')) {
      try {
        JSON.parse(stripped)
        return 'jsonc'
      } catch {
        try {
          JSON5.parse(trimmed)
          return 'jsonc'
        } catch {
          // continue
        }
      }
    }
  }

  return 'text'
}

export function detectIndent(content: string): IndentOption {
  const lines = content.split(/\r?\n/)
  let tabCount = 0
  let twoSpaceCount = 0
  let fourSpaceCount = 0

  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('\t')) {
      tabCount += 1
      continue
    }
    const match = /^( +)\S/.exec(line)
    if (!match) continue
    const spaces = match[1].length
    if (spaces === 2) {
      twoSpaceCount += 2
    } else if (spaces === 4) {
      fourSpaceCount += 1
    } else if (spaces % 4 === 0) {
      fourSpaceCount += 1
    } else if (spaces % 2 === 0) {
      twoSpaceCount += 1
    }
  }

  if (tabCount > 0 && tabCount >= twoSpaceCount && tabCount >= fourSpaceCount) {
    return 'tab'
  }
  if (fourSpaceCount > 0 && twoSpaceCount === 0) {
    return '4'
  }
  return '2'
}

export function parseJsonLike(input: string): unknown {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new SyntaxError('Empty JSON input')
  }
  try {
    return JSON.parse(trimmed)
  } catch (jsonErr) {
    try {
      return JSON.parse(stripJsonComments(trimmed))
    } catch {
      try {
        return JSON5.parse(trimmed)
      } catch {
        throw jsonErr
      }
    }
  }
}

function offsetToLineColumn(input: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, input.length))
  let line = 1
  let column = 1
  for (let i = 0; i < clamped; i += 1) {
    if (input[i] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

export function parseJsonError(
  input: string,
  format: DataFormat = 'json',
): {
  valid: boolean
  message?: string
  line?: number
  column?: number
} {
  if (!input.trim()) {
    return { valid: false, message: 'Empty JSON input', line: 1, column: 1 }
  }

  if (format === 'json5') {
    try {
      JSON5.parse(input)
      return { valid: true }
    } catch (err5: unknown) {
      const message = err5 instanceof Error ? err5.message : String(err5)
      const maybe = err5 as { lineNumber?: number; columnNumber?: number }
      return {
        valid: false,
        message,
        line: typeof maybe?.lineNumber === 'number' ? maybe.lineNumber : 1,
        column: typeof maybe?.columnNumber === 'number' ? maybe.columnNumber : 1,
      }
    }
  }

  const target = format === 'jsonc' ? stripJsonComments(input) : input
  try {
    JSON.parse(target)
    return { valid: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const lineColMatch = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message)
    if (lineColMatch) {
      return {
        valid: false,
        message,
        line: Number(lineColMatch[1]),
        column: Number(lineColMatch[2]),
      }
    }
    const posMatch = /position\s+(\d+)/i.exec(message)
    if (posMatch) {
      const { line, column } = offsetToLineColumn(target, Number(posMatch[1]))
      return { valid: false, message, line, column }
    }
    try {
      JSON5.parse(target)
    } catch (err5: unknown) {
      const maybe = err5 as { lineNumber?: number; columnNumber?: number }
      if (typeof maybe?.lineNumber === 'number') {
        return {
          valid: false,
          message,
          line: maybe.lineNumber,
          column: typeof maybe.columnNumber === 'number' ? maybe.columnNumber : 1,
        }
      }
    }
    return { valid: false, message, line: 1, column: 1 }
  }
}

function normalizeIndentation(input: string, indentStr: string): string {
  const sourceIndent = detectIndent(input)
  const sourceUnit = sourceIndent === 'tab' ? '\t' : sourceIndent === '4' ? '    ' : '  '
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmedEnd = line.replace(/[ \t]+$/, '')
      const leadingMatch = /^([ \t]+)/.exec(trimmedEnd)
      if (!leadingMatch) return trimmedEnd
      const leading = leadingMatch[1]
      const rest = trimmedEnd.slice(leading.length)
      let level = 0
      if (sourceUnit === '\t') {
        level = leading.split('\t').length - 1
        const leftoverSpaces = leading.replace(/\t/g, '').length
        level += Math.floor(leftoverSpaces / 2)
      } else {
        const expanded = leading.replace(/\t/g, sourceUnit)
        level = Math.round(expanded.length / sourceUnit.length)
      }
      return `${indentStr.repeat(level)}${rest}`
    })
    .join('\n')
}

export function formatContent(
  input: string,
  format: DataFormat,
  indent: IndentOption = '2',
): string {
  const indentStr = indentToString(indent)
  const indentNum = indent === 'tab' ? 2 : Number(indent)

  switch (format) {
    case 'json':
    case 'jsonc': {
      const parsed = parseJsonLike(input)
      return JSON.stringify(parsed, null, indentStr)
    }
    case 'json5': {
      const parsed = JSON5.parse(input)
      return JSON5.stringify(parsed, null, indent === 'tab' ? '\t' : indentNum)
    }
    case 'ndjson': {
      const lines = input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      return lines.map((line) => JSON.stringify(parseJsonLike(line))).join('\n')
    }
    default: {
      return normalizeIndentation(input, indentStr)
    }
  }
}

export function minifyContent(input: string, format: DataFormat): string {
  switch (format) {
    case 'json':
    case 'jsonc': {
      return JSON.stringify(parseJsonLike(input))
    }
    case 'json5': {
      return JSON5.stringify(JSON5.parse(input))
    }
    case 'ndjson': {
      return input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.stringify(parseJsonLike(line)))
        .join('\n')
    }
    default: {
      return input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
    }
  }
}

function sortValueKeys(value: unknown, order: 'asc' | 'desc'): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValueKeys(item, order))
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    entries.sort(([a], [b]) => {
      if (a === b) return 0
      const cmp = a < b ? -1 : 1
      return order === 'asc' ? cmp : -cmp
    })
    const sorted: Record<string, unknown> = {}
    for (const [k, v] of entries) {
      sorted[k] = sortValueKeys(v, order)
    }
    return sorted
  }
  return value
}

export function sortJsonKeys(
  input: string,
  order: 'asc' | 'desc',
  indent: IndentOption = '2',
): string {
  const parsed = parseJsonLike(input)
  const sorted = sortValueKeys(parsed, order)
  return JSON.stringify(sorted, null, indentToString(indent))
}

export function escapeJsonString(input: string): string {
  return JSON.stringify(input).slice(1, -1)
}

function wrapRawEscapedContent(input: string): string {
  let out = '"'
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      out += '\\"'
    } else if (ch === '\n') {
      out += '\\n'
    } else if (ch === '\r') {
      out += '\\r'
    } else if (ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }
  if (escaped) {
    out += '\\'
  }
  out += '"'
  return out
}

export function unescapeJsonString(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch {
      // fall through to unquoted unescape
    }
  }
  return JSON.parse(wrapRawEscapedContent(input)) as string
}

export function isEscapedJsonContent(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      const parsed = JSON.parse(trimmed)
      return typeof parsed === 'string'
    } catch {
      return false
    }
  }
  // Unquoted escaped JSON body, e.g. {\"a\": 1} or [\"x\"]
  return /\\["nrt\\/]/.test(trimmed) && !/^[[{]\s*"/.test(trimmed)
}

export function repairJsonLocal(
  input: string,
  indent: IndentOption = '2',
): { output: string; changed: boolean } {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Empty JSON input')
  }
  const repaired = jsonrepair(trimmed)
  const parsed = JSON.parse(repaired)
  const output = JSON.stringify(parsed, null, indentToString(indent))
  return {
    output,
    changed: output !== trimmed,
  }
}
