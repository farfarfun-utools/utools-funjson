import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeDiff } from '../src/lib/diff'
import {
  DATA_FORMATS,
  detectFormat,
  detectIndent,
  escapeJsonString,
  formatContent,
  getFormatMeta,
  minifyContent,
  parseJsonError,
  parseJsonLike,
  repairJsonLocal,
  sortJsonKeys,
  stripJsonComments,
  unescapeJsonString,
} from '../src/lib/formats'
import { t } from '../src/lib/i18n'
import { JSONPATH_EXAMPLES, runJsonPath } from '../src/lib/jsonpath'
import {
  autoTabName,
  createDefaultWorkspace,
  createTab,
  loadWorkspace,
  pushTabHistory,
  SAMPLES,
  saveWorkspace,
} from '../src/lib/storage'
import {
  collectAllExpandablePaths,
  collectDefaultExpandedPaths,
  exportTable,
  exportValueAsTable,
  getNodeByTablePath,
  jsonToTable,
  matchesNestedSearch,
  tablePathToJsonPath,
} from '../src/lib/table'

describe('formats.ts', () => {
  it('exposes complete metadata for all 5 JSON-family formats', () => {
    expect(DATA_FORMATS).toHaveLength(5)
    expect(getFormatMeta('json').isJsonLike).toBe(true)
    expect(getFormatMeta('json5').ext).toBe('json5')
    expect(getFormatMeta('ndjson').ext).toBe('ndjson')
  })

  it('detects format by filename priority and content heuristics', () => {
    expect(detectFormat('plain text', 'config.json5')).toBe('json5')
    expect(detectFormat('anything', '/tmp/events.jsonl')).toBe('ndjson')
    expect(detectFormat('anything', '/tmp/settings.jsonc')).toBe('jsonc')
    expect(detectFormat('   ')).toBe('json')
    expect(detectFormat('{"a": 1}')).toBe('json')
    expect(detectFormat('// header\n{"a": 1 /* inline */}')).toBe('jsonc')
    expect(detectFormat("{unquoted: 'hello', trailing: true,}")).toBe('json5')
    expect(detectFormat('{"id":1}\n{"id":2}')).toBe('ndjson')
    expect(detectFormat('just a plain sentence without markers')).toBe('text')
  })

  it('detects indentation style accurately', () => {
    expect(detectIndent('{\n  "a": 1\n}')).toBe('2')
    expect(detectIndent('{\n    "a": 1\n}')).toBe('4')
    expect(detectIndent('{\n\t"a": 1\n}')).toBe('tab')
  })

  it('strips comments while preserving comment-like text inside strings', () => {
    const src = '{\n  "url": "https://example.com/*keep*/", // line comment\n  /* block\n  comment */\n  "escaped": "a \\" // b"\n}'
    const stripped = stripJsonComments(src)
    expect(JSON.parse(stripped)).toEqual({
      url: 'https://example.com/*keep*/',
      escaped: 'a " // b',
    })
  })

  it('parses JSON, JSONC, JSON5 and reports detailed JSON errors', () => {
    expect(parseJsonLike('{"a": 1}')).toEqual({ a: 1 })
    expect(parseJsonLike('/* c */ {"a": 1}')).toEqual({ a: 1 })
    expect(parseJsonLike("{a: 'ok',}")).toEqual({ a: 'ok' })

    expect(parseJsonError('{"ok": true}')).toEqual({ valid: true })
    expect(parseJsonError('// comment\n{"ok": true}', 'jsonc')).toEqual({ valid: true })
    expect(parseJsonError("{ ok: true, tags: ['a',], }", 'json5')).toEqual({ valid: true })
    const badJson5 = parseJsonError('{ ok: }', 'json5')
    expect(badJson5.valid).toBe(false)
    expect(badJson5.line).toBeGreaterThanOrEqual(1)

    const emptyErr = parseJsonError('   ')
    expect(emptyErr.valid).toBe(false)
    expect(emptyErr.line).toBe(1)

    const badErr = parseJsonError('{\n  "a": 1,\n  "b": \n}')
    expect(badErr.valid).toBe(false)
    expect(badErr.message).toBeTruthy()
    expect(badErr.line).toBeGreaterThanOrEqual(1)
    expect(badErr.column).toBeGreaterThanOrEqual(1)
  })

  it('formats, minifies, sorts keys, escapes/unescapes, and repairs JSON locally', () => {
    expect(formatContent('{"a":1,"b":[2]}', 'json', '4')).toContain('    "a": 1')
    expect(formatContent("{a:1,b:'x',}", 'json5', '2')).toContain("b: 'x'")
    expect(formatContent('{"a": 1}\n{"b": 2}', 'ndjson', '2')).toBe('{"a":1}\n{"b":2}')

    expect(minifyContent('{\n  "a": 1,\n  "b": 2\n}', 'json')).toBe('{"a":1,"b":2}')
    expect(minifyContent('{ a: 1, b: 2, }', 'json5')).toBe('{a:1,b:2}')

    const sortedAsc = sortJsonKeys('{"z":1,"a":{"d":2,"b":3}}', 'asc', '2')
    expect(Object.keys(JSON.parse(sortedAsc))).toEqual(['a', 'z'])
    expect(Object.keys(JSON.parse(sortedAsc).a)).toEqual(['b', 'd'])

    const sortedDesc = sortJsonKeys('{"a":1,"z":2}', 'desc', '2')
    expect(Object.keys(JSON.parse(sortedDesc))).toEqual(['z', 'a'])

    const raw = '{"msg":"hello\n\\"world\\"","empty":""}'
    const escaped = escapeJsonString(raw)
    expect(unescapeJsonString(escaped)).toBe(raw)
    expect(unescapeJsonString(JSON.stringify(raw))).toBe(raw)
    expect(unescapeJsonString('""')).toBe('')
    expect(unescapeJsonString('a""b')).toBe('a""b')

    const repaired = repairJsonLocal("{name: 'FunJSON', items: [1, 2,],}")
    expect(repaired.changed).toBe(true)
    expect(JSON.parse(repaired.output)).toEqual({ name: 'FunJSON', items: [1, 2] })
  })
})

describe('jsonpath.ts', () => {
  it('evaluates RFC 9535 expressions and provides 6 curated examples', () => {
    expect(JSONPATH_EXAMPLES).toHaveLength(6)
    for (const example of JSONPATH_EXAMPLES) {
      const res = runJsonPath(SAMPLES.json, example.expression)
      expect(res.error).toBeUndefined()
      expect(res.count).toBeGreaterThan(0)
    }

    const filtered = runJsonPath(SAMPLES.json, '$.users[?@.score >= 95].name')
    expect(filtered.results).toEqual(['Alice Chen'])
    expect(filtered.count).toBe(1)

    const invalidExpr = runJsonPath(SAMPLES.json, '$.users[?bad')
    expect(invalidExpr.error).toBeTruthy()
    expect(invalidExpr.count).toBe(0)

    const emptyExpr = runJsonPath(SAMPLES.json, '   ')
    expect(emptyExpr.error).toBeTruthy()
  })
})

describe('diff.ts', () => {
  it('computes line diffs and semantic JSON diffs ignoring key order', () => {
    const left = '{"b": 2, "a": 1}'
    const right = '{"a": 1, "b": 2}'

    const rawDiff = computeDiff(left, right)
    expect(rawDiff.stats.modified).toBe(1)
    expect(rawDiff.semanticApplied).toBe(false)

    const semanticDiff = computeDiff(left, right, { semanticJson: true })
    expect(semanticDiff.semanticApplied).toBe(true)
    expect(semanticDiff.stats.added).toBe(0)
    expect(semanticDiff.stats.removed).toBe(0)
    expect(semanticDiff.stats.modified).toBe(0)

    const changed = computeDiff('line1\nline2\nline3', 'line1\nline2-mod\nline3\nline4')
    expect(changed.stats.modified).toBe(1)
    expect(changed.stats.added).toBe(1)
    expect(changed.stats.unchanged).toBe(2)
    expect(changed.unified).toContain('+ line4')
  })
})

describe('table.ts', () => {
  it('converts array of objects, single object, and array of primitives and exports formats', () => {
    const arrTable = jsonToTable('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob","extra":"x"}]')
    expect(arrTable.columns).toEqual(['id', 'name', 'extra'])
    expect(arrTable.rows).toHaveLength(2)
    expect(arrTable.rows[0].extra).toBe('')

    const objTable = jsonToTable('{"host":"localhost","port":8080}')
    expect(objTable.columns).toEqual(['host', 'port'])
    expect(objTable.rows).toEqual([{ host: 'localhost', port: '8080' }])

    const primTable = jsonToTable('[10, 20, 30]')
    expect(primTable.columns).toEqual(['value'])
    expect(primTable.rows.map((r) => r.value)).toEqual(['10', '20', '30'])

    const csv = exportTable(arrTable.columns, arrTable.rows, 'csv')
    expect(csv).toBe('id,name,extra\n1,Alice,\n2,Bob,x')
    const tsv = exportTable(arrTable.columns, arrTable.rows, 'tsv')
    expect(tsv).toBe('id\tname\textra\n1\tAlice\t\n2\tBob\tx')
    const md = exportTable(arrTable.columns, arrTable.rows, 'markdown')
    expect(md).toContain('| id | name | extra |')
    expect(md).toContain('| --- | --- | --- |')
    const jsonOut = exportTable(arrTable.columns, arrTable.rows, 'json')
    expect(JSON.parse(jsonOut)).toEqual(arrTable.rows)

    const bad = jsonToTable('{invalid')
    expect(bad.error).toBeTruthy()
  })

  it('supports recursive nested table path resolution, default/all expansion, search, and node export', () => {
    const sample = JSON.parse(SAMPLES.json) as Record<string, unknown>

    // Default expanded paths auto-expand depth-1 containers (metadata, users)
    const defaults = collectDefaultExpandedPaths(sample, 1)
    expect(defaults).toContain('root.metadata')
    expect(defaults).toContain('root.users')
    expect(defaults).not.toContain('root.users[0].profile')

    // Single-child wrapper chain auto-expands transparently
    const wrapped = { data: { items: [{ id: 1, meta: { ok: true } }] } }
    const wrappedDefaults = collectDefaultExpandedPaths(wrapped, 1)
    expect(wrappedDefaults).toContain('root.data')
    expect(wrappedDefaults).toContain('root.data.items')

    // Expand all collects deep nested paths
    const allPaths = collectAllExpandablePaths(sample)
    expect(allPaths).toContain('root.metadata')
    expect(allPaths).toContain('root.users')
    expect(allPaths).toContain('root.users[0].profile')
    expect(allPaths).toContain('root.users[0].tags')

    // Path resolution & JSONPath conversion
    const profileNode = getNodeByTablePath(sample, 'root.users[0].profile')
    expect(profileNode.found).toBe(true)
    expect(profileNode.value).toEqual({ dept: 'Platform', location: 'Shanghai' })

    const tagNode = getNodeByTablePath(sample, 'root.users[0].tags[1]')
    expect(tagNode.found).toBe(true)
    expect(tagNode.value).toBe('jsonpath')

    const missing = getNodeByTablePath(sample, 'root.users[99].profile')
    expect(missing.found).toBe(false)

    expect(tablePathToJsonPath('root')).toBe('$')
    expect(tablePathToJsonPath('root.users[0].profile')).toBe('$.users[0].profile')
    expect(tablePathToJsonPath('root["a.b"][2]')).toBe('$["a.b"][2]')

    // Recursive nested search
    expect(matchesNestedSearch('users', sample.users, 'shanghai')).toBe(true)
    expect(matchesNestedSearch('users', sample.users, 'nonexistent-xyz')).toBe(false)

    // Export any selected node (plain object, object array, primitive array)
    const objCsv = exportValueAsTable({ dept: 'Platform', location: 'Shanghai' }, 'csv')
    expect(objCsv).toBe('Key,Value\ndept,Platform\nlocation,Shanghai')

    const arrMd = exportValueAsTable(['core', 'schema'], 'markdown')
    expect(arrMd).toContain('| Index | Value |')
    expect(arrMd).toContain('| 0 | core |')

    const usersTsv = exportValueAsTable(sample.users, 'tsv')
    expect(usersTsv).toContain('id\tname\trole')
    expect(usersTsv).toContain('Alice Chen')
  })
})

describe('i18n.ts & storage.ts', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    const mockStorage: Storage = {
      get length() {
        return store.size
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      },
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
    }
    vi.stubGlobal('localStorage', mockStorage)
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates zh-CN and en keys with parameter interpolation', () => {
    expect(t('zh-CN', 'app.name')).toBe('JSON工坊')
    expect(t('en', 'app.name')).toBe('FunJSON')
    expect(t('en', 'status.matches', { count: 4 })).toBe('4 matches')
    expect(t('zh-CN', 'status.lineCol', { line: 3, column: 7 })).toBe('第 3 行，第 7 列')
    expect(t('en', 'non.existent.key')).toBe('non.existent.key')
  })

  it('persists workspace, generates smart tab names, and manages history snapshots', () => {
    const initial = loadWorkspace()
    expect(initial.tabs.length).toBeGreaterThanOrEqual(1)

    const tab = createTab({ content: '{"service": "billing-api"}', format: 'json' })
    expect(autoTabName(tab.content, 'json')).toBe('billing-api')
    expect(autoTabName('[1,2,3]', 'json')).toBe('Array[3]')
    expect(autoTabName('{"id":1}\n{"id":2}', 'ndjson')).toBe('NDJSON[2]')

    const withHist1 = pushTabHistory(tab, 'initial')
    expect(withHist1.history).toHaveLength(1)
    // Duplicate snapshot is ignored
    const withHistDup = pushTabHistory(withHist1, 'dup')
    expect(withHistDup.history).toHaveLength(1)
    // Modified content pushes new snapshot
    const withHist2 = pushTabHistory({ ...withHist1, content: '{"service":"v2"}' }, 'edit')
    expect(withHist2.history).toHaveLength(2)

    const ws = createDefaultWorkspace()
    ws.tabs.push(withHist2)
    ws.activeTabId = withHist2.id
    ws.viewMode = 'table'
    saveWorkspace(ws)

    const reloaded = loadWorkspace()
    expect(reloaded.activeTabId).toBe(withHist2.id)
    expect(reloaded.viewMode).toBe('table')
    expect(reloaded.tabs).toHaveLength(2)

    // Handles corrupted localStorage gracefully
    localStorage.setItem('funjson.workspace.v1', '{broken-json')
    const recovered = loadWorkspace()
    expect(recovered.tabs).toHaveLength(1)
  })
})
