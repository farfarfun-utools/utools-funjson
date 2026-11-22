import { indentToString, repairJsonLocal, type IndentOption } from './formats'

export type AiProvider = 'local' | 'utools-ai' | 'openai'

export interface AiConfig {
  provider: AiProvider
  utoolsModel?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  timeoutMs?: number
  indent?: IndentOption
  fallbackToLocal?: boolean
}

const DEFAULT_TIMEOUT_MS = 20000

const SYSTEM_PROMPT =
  'You are a strict JSON syntax repair engine. Fix the broken JSON and output ONLY valid RFC 8259 JSON with no markdown fences, explanations, or extra text.'

function extractJsonText(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = /^```(?:json|json5|jsonc)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  return trimmed
}

function validateAndFormatJson(raw: string, indent: IndentOption): string {
  const extracted = extractJsonText(raw)
  const parsed = JSON.parse(extracted)
  return JSON.stringify(parsed, null, indentToString(indent))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`AI repair timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function callUtoolsAi(input: string, config: AiConfig): Promise<string> {
  const api = typeof window !== 'undefined' ? window.utools : undefined
  if (!api || typeof api.ai !== 'function') {
    throw new Error('uTools AI is not available in the current environment')
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const response = await withTimeout(
    api.ai({
      ...(config.utoolsModel ? { model: config.utoolsModel } : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
    }),
    timeoutMs,
  )

  const content = typeof response === 'string' ? response : response?.content ?? ''
  if (!content.trim()) {
    throw new Error('uTools AI returned an empty response')
  }
  return content
}

async function callOpenAiCompatible(input: string, config: AiConfig): Promise<string> {
  const baseUrl = (config.baseUrl ?? '').trim()
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('OpenAI-compatible baseUrl must start with http:// or https://')
  }
  const model = (config.model ?? '').trim()
  if (!model) {
    throw new Error('OpenAI-compatible model name is required')
  }

  const endpoint = /\/chat\/completions\/?$/i.test(baseUrl)
    ? baseUrl.replace(/\/+$/, '')
    : `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.apiKey?.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
      }),
    })

    if (!resp.ok) {
      throw new Error(`OpenAI API error: HTTP ${resp.status}`)
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content.trim()) {
      throw new Error('OpenAI API returned an empty response')
    }
    return content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`AI repair timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function repairJsonWithAi(
  input: string,
  config: AiConfig,
): Promise<{ output: string; source: 'local' | 'utools-ai' | 'openai' }> {
  const indent = config.indent ?? '2'
  const allowFallback = config.fallbackToLocal !== false

  if (config.provider === 'local') {
    const fixed = repairJsonLocal(input, indent)
    return { output: fixed.output, source: 'local' }
  }

  try {
    const raw =
      config.provider === 'utools-ai'
        ? await callUtoolsAi(input, config)
        : await callOpenAiCompatible(input, config)
    const output = validateAndFormatJson(raw, indent)
    return { output, source: config.provider }
  } catch (primaryErr) {
    if (allowFallback) {
      try {
        const fixed = repairJsonLocal(input, indent)
        return { output: fixed.output, source: 'local' }
      } catch {
        // throw original remote error below
      }
    }
    throw primaryErr instanceof Error ? primaryErr : new Error(String(primaryErr))
  }
}
