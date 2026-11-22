import type { AiConfig } from './ai-repair'
import { DATA_FORMATS, parseJsonLike, type DataFormat, type IndentOption } from './formats'
import type { Locale } from './i18n'

export type ViewMode = 'code' | 'tree' | 'columns' | 'table' | 'diff'

export type ToolId = 'repair' | 'types' | 'jsonpath' | 'naming'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface TabHistoryEntry {
  id: string
  content: string
  format: DataFormat
  timestamp: number
  label?: string
}

export interface TabItem {
  id: string
  title: string
  format: DataFormat
  content: string
  diffRight: string
  indent: IndentOption
  filename?: string
  updatedAt: number
  history: TabHistoryEntry[]
}

export interface SmartDisplaySettings {
  embeddedJson: boolean
  colorSwatch: boolean
  timestamp: boolean
  base64: boolean
  foldSummary: boolean
}

export interface FunJsonSettings {
  theme: ThemeMode
  locale: Locale
  defaultIndent: IndentOption
  fontSize: number
  wordWrap: boolean
  timeZone: string
  smartDisplay: SmartDisplaySettings
  ai: AiConfig
}

export interface WorkspaceState {
  version: number
  activeTabId: string
  viewMode: ViewMode
  activeTool: ToolId | null
  tabs: TabItem[]
  settings: FunJsonSettings
}

const STORAGE_KEY = 'funjson.workspace.v1'
const WORKSPACE_VERSION = 1
const MAX_PERSISTED_CONTENT_LEN = 250_000
const DEFAULT_MAX_HISTORY = 20
const VALID_FORMATS = new Set<string>(DATA_FORMATS.map((f) => f.id))
const VALID_TOOLS = new Set<string>(['repair', 'types', 'jsonpath', 'naming'])

export const SAMPLES = {
  json: JSON.stringify(
    {
      service: 'funjson-workbench',
      version: '0.1.0',
      generatedAt: 1732272000,
      accentColor: '#0284C7',
      metadata: {
        region: 'ap-east-1',
        encodedTag: 'RnVuSlNPTiBKU09O5bel5Z2K',
        callbackUrl: 'https%3A%2F%2Ffarfarfun.dev%2Fapi%3Fq%3Djson',
      },
      users: [
        {
          id: 1001,
          name: 'Alice Chen',
          role: 'admin',
          active: true,
          score: 96.5,
          profile: {
            dept: 'Platform',
            location: 'Shanghai',
          },
          tags: ['core', 'jsonpath', 'schema'],
        },
        {
          id: 1002,
          name: 'Bob Lin',
          role: 'developer',
          active: true,
          score: 91,
          profile: {
            dept: 'Data Infra',
            location: 'Shenzhen',
          },
          tags: ['json5', 'diff'],
          nickname: 'bobby',
        },
        {
          id: 1003,
          name: 'Carol Wu',
          role: 'viewer',
          active: false,
          score: 78,
          profile: {
            dept: 'Design',
            location: 'Hangzhou',
          },
          tags: ['table'],
        },
      ],
    },
    null,
    2,
  ),
  json5: [
    '{',
    '  // FunJSON JSON5 配置示例（支持注释、单引号、无引号键名与尾逗号）',
    "  service: 'funjson-gateway',",
    "  environment: 'production',",
    '  retryLimit: 3,',
    '  /* 路由策略 */',
    '  routes: [',
    "    { path: '/v1/format', timeoutMs: 3000, enabled: true, },",
    "    { path: '/v1/query', timeoutMs: 5000, enabled: true, },",
    '  ],',
    '}',
  ].join('\n'),
  broken: [
    '{',
    "  service: 'funjson-repair-demo',",
    '  version: 2,',
    "  tags: ['offline', 'jsonpath', 'table',],",
    '  // missing closing quote & trailing comma',
    '  config: { indent: 2, strict: true, },',
    '}',
  ].join('\n'),
  ndjson: [
    '{"ts":1732272001,"level":"info","service":"api-gateway","latencyMs":18,"status":200}',
    '{"ts":1732272004,"level":"warn","service":"auth-worker","latencyMs":245,"status":429}',
    '{"ts":1732272009,"level":"error","service":"billing-job","latencyMs":512,"status":503}',
  ].join('\n'),
} as const

function generateId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultSettings(): FunJsonSettings {
  let timeZone = 'Asia/Shanghai'
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || timeZone
  } catch {
    // keep default
  }
  return {
    theme: 'system',
    locale: 'zh-CN',
    defaultIndent: '2',
    fontSize: 13,
    wordWrap: true,
    timeZone,
    smartDisplay: {
      embeddedJson: true,
      colorSwatch: true,
      timestamp: true,
      base64: true,
      foldSummary: true,
    },
    ai: {
      provider: 'local',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      timeoutMs: 20000,
    },
  }
}

export function createTab(partial?: Partial<TabItem>): TabItem {
  return {
    id: partial?.id ?? generateId('tab'),
    title: partial?.title ?? 'Untitled',
    format: partial?.format ?? 'json',
    content: partial?.content ?? '',
    diffRight: partial?.diffRight ?? '',
    indent: partial?.indent ?? '2',
    filename: partial?.filename,
    updatedAt: partial?.updatedAt ?? Date.now(),
    history: partial?.history ?? [],
  }
}

export function createDefaultWorkspace(): WorkspaceState {
  const initialTab = createTab({
    id: 'tab_welcome',
    title: 'funjson-workbench',
    format: 'json',
    content: SAMPLES.json,
    diffRight: SAMPLES.json,
  })
  return {
    version: WORKSPACE_VERSION,
    activeTabId: initialTab.id,
    viewMode: 'code',
    activeTool: null,
    tabs: [initialTab],
    settings: createDefaultSettings(),
  }
}

export function autoTabName(
  content: string,
  format: DataFormat,
  fallback = 'Untitled',
): string {
  const trimmed = content.trim()
  if (!trimmed) return fallback

  if (format === 'json' || format === 'jsonc' || format === 'json5') {
    try {
      const parsed = parseJsonLike(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        for (const candidateKey of ['name', 'title', 'service', 'id', 'app', 'project']) {
          const val = record[candidateKey]
          if (typeof val === 'string' && val.trim()) {
            return val.trim().slice(0, 28)
          }
        }
        const firstKey = Object.keys(record)[0]
        if (firstKey) return firstKey.slice(0, 28)
      }
      if (Array.isArray(parsed)) {
        return `Array[${parsed.length}]`
      }
    } catch {
      // fall through
    }
  }

  if (format === 'ndjson') {
    const count = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length
    return `NDJSON[${count}]`
  }

  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine && firstLine.length <= 28) {
    return firstLine
  }
  return fallback
}

export function pushTabHistory(
  tab: TabItem,
  label?: string,
  maxEntries = DEFAULT_MAX_HISTORY,
): TabItem {
  const latest = tab.history[0]
  if (latest && latest.content === tab.content && latest.format === tab.format) {
    return tab
  }
  const entry: TabHistoryEntry = {
    id: generateId('hist'),
    content: tab.content,
    format: tab.format,
    timestamp: Date.now(),
    label,
  }
  const nextHistory = [entry, ...tab.history].slice(0, Math.max(1, maxEntries))
  return {
    ...tab,
    updatedAt: entry.timestamp,
    history: nextHistory,
  }
}

function getSafeStorage(): Storage | null {
  try {
    const candidate =
      typeof window !== 'undefined' && window.localStorage
        ? window.localStorage
        : globalThis.localStorage
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate
    }
  } catch {
    // ignore inaccessible storage
  }
  return null
}

export function loadWorkspace(): WorkspaceState {
  const fallback = createDefaultWorkspace()
  const storage = getSafeStorage()
  if (!storage) {
    return fallback
  }

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return fallback
    }

    const tabs: TabItem[] = parsed.tabs
      .filter((item): item is TabItem => Boolean(item && typeof item === 'object' && typeof item.id === 'string'))
      .map((item) =>
        createTab({
          id: item.id,
          title: typeof item.title === 'string' && item.title ? item.title : 'Untitled',
          format:
            typeof item.format === 'string' && VALID_FORMATS.has(item.format)
              ? (item.format as DataFormat)
              : 'json',
          content: typeof item.content === 'string' ? item.content : '',
          diffRight: typeof item.diffRight === 'string' ? item.diffRight : '',
          indent: item.indent === '4' || item.indent === 'tab' ? item.indent : '2',
          filename: typeof item.filename === 'string' ? item.filename : undefined,
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          history: Array.isArray(item.history) ? item.history.slice(0, DEFAULT_MAX_HISTORY) : [],
        }),
      )

    if (tabs.length === 0) return fallback

    const defaults = createDefaultSettings()
    const rawSettings = parsed.settings ?? ({} as Partial<FunJsonSettings>)
    const settings: FunJsonSettings = {
      ...defaults,
      ...rawSettings,
      smartDisplay: {
        ...defaults.smartDisplay,
        ...(rawSettings.smartDisplay ?? {}),
      },
      ai: {
        ...defaults.ai,
        ...(rawSettings.ai ?? {}),
      },
    }

    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId)
      ? (parsed.activeTabId as string)
      : tabs[0].id

    const validViews: ViewMode[] = ['code', 'tree', 'columns', 'table', 'diff']
    const viewMode = validViews.includes(parsed.viewMode as ViewMode)
      ? (parsed.viewMode as ViewMode)
      : 'code'

    const activeTool =
      typeof parsed.activeTool === 'string' && VALID_TOOLS.has(parsed.activeTool)
        ? (parsed.activeTool as ToolId)
        : null

    return {
      version: WORKSPACE_VERSION,
      activeTabId,
      viewMode,
      activeTool,
      tabs,
      settings,
    }
  } catch {
    return fallback
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  const storage = getSafeStorage()
  if (!storage) return
  const sanitizedTabs = state.tabs.map((tab) => ({
    ...tab,
    content: tab.content.slice(0, MAX_PERSISTED_CONTENT_LEN),
    diffRight: tab.diffRight.slice(0, MAX_PERSISTED_CONTENT_LEN),
    history: tab.history
      .slice(0, DEFAULT_MAX_HISTORY)
      .filter((entry) => entry.content.length <= 50_000),
  }))

  const payload: WorkspaceState = {
    ...state,
    version: WORKSPACE_VERSION,
    tabs: sanitizedTabs,
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    try {
      const compact: WorkspaceState = {
        ...payload,
        tabs: sanitizedTabs.map((tab) => ({ ...tab, history: [] })),
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(compact))
    } catch {
      // ignore storage quota errors
    }
  }
}
