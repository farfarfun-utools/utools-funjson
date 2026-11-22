import { afterEach, describe, expect, it, vi } from 'vitest'
import { repairJsonWithAi } from '../src/lib/ai-repair'
import {
  formatJsonTool,
  FUNJSON_AI_TOOL_HANDLERS,
  jsonToTypesTool,
  queryJsonPathTool,
  registerFunJsonAiTools,
} from '../src/lib/ai-tools'
import {
  decodeText,
  encodeText,
  formatTimestamp,
  inspectToken,
  parseDateToTimestamp,
} from '../src/lib/decoders'
import { convertJsonKeys, convertKeyName } from '../src/lib/keynaming'
import { generateTypes, TARGET_LANGUAGES } from '../src/lib/typegen'

describe('typegen.ts', () => {
  const sample = JSON.stringify({
    user_id: 42,
    createdAt: '2026-11-22',
    type: 'order',
    class: 'premium',
    profile: { name: 'Alice', bio: null },
    items: [
      { id: 1, price: 9.9, tag: 'hot' },
      { id: 2, price: 12 },
    ],
    nested: { item: { id: 3 } },
  })

  it('generates types for all 9 target languages with merged optional array fields and deduped names', () => {
    expect(TARGET_LANGUAGES).toHaveLength(9)
    for (const lang of TARGET_LANGUAGES) {
      const code = generateTypes(sample, lang.id, 'OrderResponse')
      expect(code.length).toBeGreaterThan(20)
    }

    const ts = generateTypes(sample, 'typescript', 'OrderResponse')
    expect(ts).toContain('export interface OrderResponse')
    expect(ts).toContain('tag?: string;')
    expect(ts).toContain('export interface Item2')

    const go = generateTypes(sample, 'go', 'OrderResponse')
    expect(go).toContain('`json:"user_id"`')
    expect(go).toContain('`json:"tag,omitempty"`')

    const rust = generateTypes(sample, 'rust', 'OrderResponse')
    expect(rust).toContain('#[serde(rename = "createdAt")]')
    expect(rust).toContain('pub r#type: String')
    expect(rust).toContain('Option<String>')

    const schema = JSON.parse(generateTypes(sample, 'jsonschema', 'OrderResponse'))
    expect(schema.$schema).toContain('2020-12')
    expect(schema.properties.items.items.required).toContain('id')
    expect(schema.properties.items.items.required).not.toContain('tag')
  })
})

describe('keynaming.ts', () => {
  it('converts individual keys and recursively transforms JSON keys with ignore list', () => {
    expect(convertKeyName('user_profile_id', 'camel')).toBe('userProfileId')
    expect(convertKeyName('XMLHttpRequest', 'snake')).toBe('xml_http_request')
    expect(convertKeyName('user-profile-id', 'pascal')).toBe('UserProfileId')
    expect(convertKeyName('userProfileId', 'kebab')).toBe('user-profile-id')
    expect(convertKeyName('userProfileId', 'constant')).toBe('USER_PROFILE_ID')
    expect(convertKeyName('user_profile_id', 'dot')).toBe('user.profile.id')

    const transformed = JSON.parse(
      convertJsonKeys(
        '{"user_name":"Alice","keep_me":1,"nested_obj":{"created_at":123}}',
        'camel',
        ['keep_me'],
      ),
    )
    expect(transformed).toEqual({
      userName: 'Alice',
      keep_me: 1,
      nestedObj: { createdAt: 123 },
    })
  })
})

describe('decoders.ts', () => {
  it('round-trips all 6 encoding kinds including UTF-8 CJK and emoji', () => {
    const text = 'JSON工坊 FunJSON 🚀 & <tag> "hi"'
    for (const kind of ['base64', 'url', 'unicode', 'html', 'hex', 'json-string'] as const) {
      const encoded = encodeText(text, kind)
      expect(decodeText(encoded, kind)).toBe(text)
    }
  })

  it('parses and formats timestamps and inspects smart tokens', () => {
    const ts = formatTimestamp(1732272000, 'UTC')
    expect(ts).not.toBeNull()
    expect(ts?.seconds).toBe(1732272000)
    expect(ts?.milliseconds).toBe(1732272000000)
    expect(ts?.iso).toBe('2024-11-22T10:40:00.000Z')

    const parsed = parseDateToTimestamp('2024-11-22T10:40:00.000Z')
    expect(parsed?.seconds).toBe(1732272000)
    expect(parseDateToTimestamp('not-a-date')).toBeNull()

    expect(inspectToken('1732272000').some((i) => i.kind === 'timestamp')).toBe(true)
    expect(inspectToken('#0284C7').some((i) => i.kind === 'color' && i.previewColor === '#0284C7')).toBe(true)
    expect(inspectToken('rgb(2, 132, 199)').some((i) => i.kind === 'color')).toBe(true)
    expect(inspectToken(encodeText('FunJSON JSON工坊', 'base64')).some((i) => i.kind === 'base64' && i.value === 'FunJSON JSON工坊')).toBe(true)
    expect(inspectToken('hello%20FunJSON').some((i) => i.kind === 'url')).toBe(true)
    expect(inspectToken('\\u5de5\\u574a').some((i) => i.kind === 'unicode' && i.value === '工坊')).toBe(true)
    expect(inspectToken('"{\\"k\\":1}"').some((i) => i.kind === 'json-string')).toBe(true)
  })
})

describe('ai-tools.ts', () => {
  afterEach(() => {
    delete window.utools
  })

  it('guards null, undefined, and malformed inputs across all 3 AI tool handlers', () => {
    const handlers = Object.values(FUNJSON_AI_TOOL_HANDLERS)
    for (const handler of handlers) {
      expect(handler(null).ok).toBe(false)
      expect(handler(undefined).ok).toBe(false)
      expect(handler({}).ok).toBe(false)
      expect(handler('bad-param').ok).toBe(false)
    }

    expect(formatJsonTool({ input: '{a:1,b:2}', sortKeys: 'desc', indent: 2 }).output).toBe(
      '{\n  "b": 2,\n  "a": 1\n}',
    )
    expect(formatJsonTool({ input: '{"a": 1}', mode: 'minify' }).output).toBe('{"a":1}')
    expect(formatJsonTool({ input: '{broken', repair: false }).ok).toBe(false)
    expect(formatJsonTool({ input: '{"a":1}', indent: 99 }).ok).toBe(false)

    const jp = queryJsonPathTool({ input: '{"items":[10,20,30]}', expression: '$.items[?@ > 15]' })
    expect(jp.ok).toBe(true)
    expect(jp.results).toEqual([20, 30])

    const types = jsonToTypesTool({ input: '{"id":1}', language: 'typescript', rootName: 'User' })
    expect(types.ok).toBe(true)
    expect(types.output).toContain('export interface User')
    expect(jsonToTypesTool({ input: '{"id":1}', language: 'cobol' }).ok).toBe(false)
  })

  it('registers all 3 tools matching plugin.json names on window.utools', () => {
    const names: string[] = []
    window.utools = {
      registerTool: (name) => {
        names.push(name)
      },
    }
    const registered = registerFunJsonAiTools()
    expect(registered).toEqual(['format_json', 'query_jsonpath', 'json_to_types'])
    expect(names).toEqual(registered)
  })
})

describe('ai-repair.ts', () => {
  afterEach(() => {
    delete window.utools
    vi.restoreAllMocks()
  })

  it('repairs locally, via uTools AI, and via OpenAI-compatible API with timeout/fallback', async () => {
    const local = await repairJsonWithAi("{a: 1, b: 'x',}", { provider: 'local' })
    expect(local.source).toBe('local')
    expect(JSON.parse(local.output)).toEqual({ a: 1, b: 'x' })

    window.utools = {
      ai: vi.fn(async () => ({ content: '```json\n{"fixed": true}\n```' })),
    }
    const viaUtools = await repairJsonWithAi('{fixed: true}', { provider: 'utools-ai' })
    expect(viaUtools.source).toBe('utools-ai')
    expect(JSON.parse(viaUtools.output)).toEqual({ fixed: true })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"via": "openai"}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const viaOpenAi = await repairJsonWithAi('{via: "openai"}', {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    })
    expect(viaOpenAi.source).toBe('openai')
    expect(JSON.parse(viaOpenAi.output)).toEqual({ via: 'openai' })

    // Falls back to local repair when remote fails
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const fallback = await repairJsonWithAi('{ok: 1,}', {
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
    })
    expect(fallback.source).toBe('local')
    expect(JSON.parse(fallback.output)).toEqual({ ok: 1 })

    // Propagates error when fallbackToLocal is false
    await expect(
      repairJsonWithAi('{ok: 1,}', {
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
        fallbackToLocal: false,
      }),
    ).rejects.toThrow('HTTP 401')
  })
})
