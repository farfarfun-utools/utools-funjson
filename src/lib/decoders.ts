export type EncodingKind = 'base64' | 'url' | 'unicode' | 'html' | 'hex' | 'json-string'

export interface TimestampInfo {
  seconds: number
  milliseconds: number
  iso: string
  local: string
  relative: string
}

export interface SmartInspection {
  kind: 'timestamp' | 'base64' | 'url' | 'unicode' | 'json-string' | 'color'
  label: string
  value: string
  detail?: string
  previewColor?: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(raw: string): Uint8Array {
  const cleaned = raw.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) {
    throw new Error('Invalid Base64 string')
  }
  const padLen = (4 - (cleaned.length % 4)) % 4
  const padded = cleaned + '='.repeat(padLen)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function encodeText(input: string, kind: EncodingKind): string {
  switch (kind) {
    case 'base64': {
      const bytes = new TextEncoder().encode(input)
      return bytesToBase64(bytes)
    }
    case 'url':
      return encodeURIComponent(input)
    case 'unicode': {
      let out = ''
      for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i)
        if (code > 0x7f) {
          out += `\\u${code.toString(16).padStart(4, '0')}`
        } else {
          out += input[i]
        }
      }
      return out
    }
    case 'html':
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
    case 'hex': {
      const bytes = new TextEncoder().encode(input)
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }
    case 'json-string':
      return JSON.stringify(input)
  }
}

export function decodeText(input: string, kind: EncodingKind): string {
  switch (kind) {
    case 'base64': {
      const bytes = base64ToBytes(input)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    case 'url':
      return decodeURIComponent(input.replace(/\+/g, ' '))
    case 'unicode':
      return input
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) =>
          String.fromCodePoint(parseInt(hex, 16)),
        )
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
    case 'html':
      return input
        .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) =>
          String.fromCodePoint(parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec: string) =>
          String.fromCodePoint(parseInt(dec, 10)),
        )
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
    case 'hex': {
      const cleaned = input.trim().replace(/^0x/i, '').replace(/[\s:-]+/g, '')
      if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
        throw new Error('Invalid hex string')
      }
      const bytes = new Uint8Array(cleaned.length / 2)
      for (let i = 0; i < cleaned.length; i += 2) {
        bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16)
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    case 'json-string': {
      const trimmed = input.trim()
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        const parsed = JSON.parse(trimmed)
        if (typeof parsed === 'string') return parsed
      }
      const wrapped = `"${input.replace(/(^|[^\\])"/g, '$1\\"')}"`
      return JSON.parse(wrapped) as string
    }
  }
}

function formatRelativeTime(diffMs: number): string {
  const abs = Math.abs(diffMs)
  const future = diffMs > 0
  if (abs < 5000) return 'just now'

  const units: Array<[number, string]> = [
    [1000 * 60 * 60 * 24 * 365, 'year'],
    [1000 * 60 * 60 * 24 * 30, 'month'],
    [1000 * 60 * 60 * 24, 'day'],
    [1000 * 60 * 60, 'hour'],
    [1000 * 60, 'minute'],
    [1000, 'second'],
  ]

  for (const [unitMs, label] of units) {
    if (abs >= unitMs) {
      const count = Math.floor(abs / unitMs)
      const plural = count === 1 ? label : `${label}s`
      return future ? `in ${count} ${plural}` : `${count} ${plural} ago`
    }
  }
  return 'just now'
}

export function formatTimestamp(
  ts: number | string,
  timeZone?: string,
): TimestampInfo | null {
  const raw = typeof ts === 'string' ? ts.trim() : String(ts)
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null
  const num = Number(raw)
  if (!Number.isFinite(num)) return null

  const isMs = Math.abs(num) >= 1e11
  const milliseconds = Math.trunc(isMs ? num : num * 1000)
  const seconds = Math.trunc(milliseconds / 1000)
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) return null

  const iso = date.toISOString()
  let local: string
  try {
    local = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(date)
  } catch {
    local = date.toLocaleString()
  }

  const relative = formatRelativeTime(milliseconds - Date.now())
  return { seconds, milliseconds, iso, local, relative }
}

export function parseDateToTimestamp(
  input: string,
): { seconds: number; milliseconds: number; iso: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^-?\d{10}$/.test(trimmed) || /^-?\d{13}$/.test(trimmed)) {
    const info = formatTimestamp(trimmed)
    return info
      ? { seconds: info.seconds, milliseconds: info.milliseconds, iso: info.iso }
      : null
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)
    ? trimmed.replace(/\s+/, 'T')
    : trimmed
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return null
  const date = new Date(ms)
  return {
    seconds: Math.trunc(ms / 1000),
    milliseconds: ms,
    iso: date.toISOString(),
  }
}

const COLOR_REGEX =
  /^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)|hsla?\(\s*\d{1,3}(?:deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\))$/i

function isMostlyPrintable(text: string): boolean {
  if (!text) return false
  let printable = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 0xfffd) return false
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1
    }
  }
  return printable / text.length >= 0.9
}

export function inspectToken(raw: string, timeZone?: string): SmartInspection[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  let value = trimmed
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') {
        value = parsed
      }
    } catch {
      // keep trimmed
    }
  }

  const findings: SmartInspection[] = []

  // 1. Timestamp (10-digit seconds or 13-digit milliseconds)
  if (/^\d{10}$/.test(value) || /^\d{13}$/.test(value)) {
    const info = formatTimestamp(value, timeZone)
    if (info) {
      findings.push({
        kind: 'timestamp',
        label: value.length === 13 ? 'Unix Timestamp (ms)' : 'Unix Timestamp (s)',
        value: info.local,
        detail: `${info.iso} (${info.relative})`,
      })
    }
  }

  // 2. Color (HEX / RGB / HSL)
  if (COLOR_REGEX.test(value)) {
    findings.push({
      kind: 'color',
      label: 'Color',
      value,
      previewColor: value,
    })
  }

  // 3. Unicode escape sequences
  if (/\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.test(trimmed)) {
    const decoded = decodeText(trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed, 'unicode')
    if (decoded !== value && decoded !== trimmed) {
      findings.push({
        kind: 'unicode',
        label: 'Unicode Decoded',
        value: decoded,
      })
    }
  }

  // 4. URL encoded string
  if (/%[0-9a-fA-F]{2}/.test(value)) {
    try {
      const decoded = decodeText(value, 'url')
      if (decoded !== value) {
        findings.push({
          kind: 'url',
          label: 'URL Decoded',
          value: decoded,
        })
      }
    } catch {
      // ignore invalid percent encoding
    }
  }

  // 5. Embedded JSON string (object or array)
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(value)
      if (parsed !== null && typeof parsed === 'object') {
        findings.push({
          kind: 'json-string',
          label: 'Embedded JSON',
          value: JSON.stringify(parsed, null, 2),
        })
      }
    } catch {
      // not valid embedded JSON
    }
  }

  // 6. Base64 UTF-8 text
  if (
    value.length >= 8 &&
    !/^\d+$/.test(value) &&
    /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) &&
    value.length % 4 !== 1
  ) {
    const hasBase64Signal =
      value.includes('=') ||
      value.includes('+') ||
      value.includes('/') ||
      value.includes('_') ||
      value.includes('-') ||
      (/[A-Z]/.test(value) && /[a-z]/.test(value) && value.length % 4 === 0)
    if (hasBase64Signal) {
      try {
        const decoded = decodeText(value, 'base64')
        if (decoded && decoded !== value && isMostlyPrintable(decoded)) {
          findings.push({
            kind: 'base64',
            label: 'Base64 Decoded',
            value: decoded,
          })
        }
      } catch {
        // not valid UTF-8 base64
      }
    }
  }

  return findings
}
