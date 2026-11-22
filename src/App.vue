<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import logoUrl from '../utools/logo.png'
import AppIcon, { type IconName } from './components/AppIcon.vue'
import CodeEditorView from './components/CodeEditorView.vue'
import ColumnView from './components/ColumnView.vue'
import DiffView from './components/DiffView.vue'
import HistoryModal from './components/HistoryModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import TableView from './components/TableView.vue'
import ToolboxView from './components/ToolboxView.vue'
import TreeView from './components/TreeView.vue'
import { repairJsonWithAi } from './lib/ai-repair'
import { registerFunJsonAiTools } from './lib/ai-tools'
import {
  DATA_FORMATS,
  detectFormat,
  escapeJsonString,
  formatContent,
  getFormatMeta,
  minifyContent,
  parseJsonError,
  repairJsonLocal,
  sortJsonKeys,
  unescapeJsonString,
  type DataFormat,
  type IndentOption,
} from './lib/formats'
import { t } from './lib/i18n'
import {
  autoTabName,
  createTab,
  loadWorkspace,
  pushTabHistory,
  SAMPLES,
  saveWorkspace,
  type FunJsonSettings,
  type TabHistoryEntry,
  type TabItem,
  type ToolId,
  type ViewMode,
  type WorkspaceState,
} from './lib/storage'

const workspace = ref<WorkspaceState>(loadWorkspace())
const sidebarCollapsed = ref(false)
const mobileNavOpen = ref(false)
const showHistory = ref(false)
const showSettings = ref(false)
const showSampleMenu = ref(false)
const jsonPathOpen = ref(false)
const dragOver = ref(false)
const cursorPos = ref({ line: 1, col: 1 })
const sortOrder = ref<'asc' | 'desc'>('asc')
const escapedState = ref(false)

const renamingTabId = ref<string | null>(null)
const renameDraft = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const codeEditorRef = ref<InstanceType<typeof CodeEditorView> | null>(null)

const toast = ref<{ message: string; kind: 'info' | 'success' | 'error' } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribeEnter: (() => void) | null = null

const VIEW_TABS: Array<{ id: ViewMode; icon: IconName }> = [
  { id: 'code', icon: 'code' },
  { id: 'tree', icon: 'network' },
  { id: 'table', icon: 'table' },
  { id: 'columns', icon: 'columns' },
  { id: 'diff', icon: 'diff' },
]

const prefersDark = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false,
)

const effectiveDark = computed(() => {
  if (workspace.value.settings.theme === 'dark') return true
  if (workspace.value.settings.theme === 'light') return false
  if (typeof window !== 'undefined' && window.utools?.isDarkColors) {
    return Boolean(window.utools.isDarkColors())
  }
  return prefersDark.value
})

const themeIcon = computed<IconName>(() => {
  const mode = workspace.value.settings.theme
  if (mode === 'system') return 'monitor'
  return mode === 'dark' ? 'moon' : 'sun'
})

const activeTab = computed<TabItem>(() => {
  const found = workspace.value.tabs.find((item) => item.id === workspace.value.activeTabId)
  return found ?? workspace.value.tabs[0]
})

const locale = computed(() => workspace.value.settings.locale)
const inToolbox = computed(() => workspace.value.activeTool !== null)
const currentTool = computed<ToolId>(() => workspace.value.activeTool ?? 'types')
const isJsonLike = computed(() => getFormatMeta(activeTab.value.format).isJsonLike)

const jsonValidation = computed(() => {
  if (!isJsonLike.value) return null
  return parseJsonError(activeTab.value.content)
})

const activeStats = computed(() => {
  const text = activeTab.value.content
  const lines = text ? text.split(/\r?\n/).length : 0
  const bytes = new TextEncoder().encode(text).length
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
  return { lines, size }
})

function notify(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  toast.value = { message, kind }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 2400)
}

function applyThemeAttribute() {
  if (typeof document === 'undefined') return
  const mode = workspace.value.settings.theme
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.utools?.isDarkColors) {
      document.documentElement.dataset.theme = window.utools.isDarkColors() ? 'dark' : 'light'
    } else {
      delete document.documentElement.dataset.theme
    }
  } else {
    document.documentElement.dataset.theme = mode
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveWorkspace(workspace.value)
  }, 250)
}

watch(
  workspace,
  () => {
    applyThemeAttribute()
    scheduleSave()
  },
  { deep: true },
)

function updateActiveTab(updater: (tab: TabItem) => TabItem) {
  const idx = workspace.value.tabs.findIndex((item) => item.id === activeTab.value.id)
  if (idx === -1) return
  workspace.value.tabs[idx] = updater(workspace.value.tabs[idx])
}

function snapshotActiveTab(label: string) {
  updateActiveTab((tab) => pushTabHistory(tab, label))
}

function setActiveContent(next: string) {
  updateActiveTab((tab) => ({ ...tab, content: next, updatedAt: Date.now() }))
}

function setActiveDiffRight(next: string) {
  updateActiveTab((tab) => ({ ...tab, diffRight: next, updatedAt: Date.now() }))
}

function setActiveFormat(next: DataFormat) {
  updateActiveTab((tab) => ({ ...tab, format: next, updatedAt: Date.now() }))
}

function setActiveIndent(next: IndentOption) {
  updateActiveTab((tab) => ({ ...tab, indent: next, updatedAt: Date.now() }))
}

function openNewTab(opts?: {
  content?: string
  format?: DataFormat
  title?: string
  filename?: string
}) {
  const content = opts?.content ?? ''
  const format = opts?.format ?? (content ? detectFormat(content, opts?.filename) : 'json')
  const title =
    opts?.title ??
    opts?.filename ??
    (content ? autoTabName(content, format, 'Untitled') : `Tab ${workspace.value.tabs.length + 1}`)
  const tab = createTab({
    title,
    format,
    content,
    diffRight: content,
    indent: workspace.value.settings.defaultIndent,
    filename: opts?.filename,
  })
  workspace.value.tabs.push(tab)
  workspace.value.activeTabId = tab.id
  workspace.value.activeTool = null
  showSampleMenu.value = false
}

function closeTab(id: string) {
  if (workspace.value.tabs.length <= 1) {
    updateActiveTab((tab) => ({ ...tab, content: '', title: 'Untitled', updatedAt: Date.now() }))
    return
  }
  const idx = workspace.value.tabs.findIndex((tab) => tab.id === id)
  if (idx === -1) return
  workspace.value.tabs.splice(idx, 1)
  if (workspace.value.activeTabId === id) {
    const nextIdx = Math.max(0, idx - 1)
    workspace.value.activeTabId = workspace.value.tabs[nextIdx].id
  }
}

function startRename(tab: TabItem) {
  renamingTabId.value = tab.id
  renameDraft.value = tab.title
}

function commitRename(tabId: string) {
  const trimmed = renameDraft.value.trim()
  if (trimmed) {
    const target = workspace.value.tabs.find((item) => item.id === tabId)
    if (target) target.title = trimmed.slice(0, 32)
  }
  renamingTabId.value = null
}

function loadSample(kind: keyof typeof SAMPLES) {
  showSampleMenu.value = false
  const content = SAMPLES[kind]
  const format: DataFormat =
    kind === 'json5' ? 'json5' : kind === 'ndjson' ? 'ndjson' : 'json'
  const fallbackTitle = kind === 'broken' ? 'broken-demo.json' : `sample.${format}`
  openNewTab({
    content,
    format,
    title: kind === 'broken' ? fallbackTitle : autoTabName(content, format, fallbackTitle),
  })
}

function handleCommandTrigger() {
  if (!inToolbox.value && workspace.value.viewMode === 'code') {
    jsonPathOpen.value = !jsonPathOpen.value
    if (jsonPathOpen.value) {
      nextTick(() => codeEditorRef.value?.focusJsonPath())
    }
    return
  }
  workspace.value.activeTool = null
  workspace.value.viewMode = 'code'
  jsonPathOpen.value = true
  nextTick(() => codeEditorRef.value?.focusJsonPath())
}

// Toolbar actions
function handleFormat() {
  try {
    snapshotActiveTab(t(locale.value, 'action.format'))
    const formatted = formatContent(activeTab.value.content, activeTab.value.format, activeTab.value.indent)
    setActiveContent(formatted)
    notify(locale.value === 'en' ? 'Formatted' : '已格式化', 'success')
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Format failed', 'error')
  }
}

function handleMinify() {
  try {
    snapshotActiveTab(t(locale.value, 'action.minify'))
    const minified = minifyContent(activeTab.value.content, activeTab.value.format)
    setActiveContent(minified)
    notify(locale.value === 'en' ? 'Minified' : '已压缩', 'success')
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Minify failed', 'error')
  }
}

async function handleRepair() {
  try {
    snapshotActiveTab(t(locale.value, 'tool.repair'))
    if (workspace.value.settings.ai.provider === 'local') {
      const res = repairJsonLocal(activeTab.value.content, activeTab.value.indent)
      setActiveContent(res.output)
      notify(locale.value === 'en' ? 'Repaired JSON locally' : '已完成本地 JSON 修复', 'success')
    } else {
      const res = await repairJsonWithAi(activeTab.value.content, {
        ...workspace.value.settings.ai,
        indent: activeTab.value.indent,
      })
      setActiveContent(res.output)
      notify(
        locale.value === 'en' ? `Repaired via ${res.source}` : `已修复（引擎：${res.source}）`,
        'success',
      )
    }
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Repair failed', 'error')
  }
}

function handleSortKeys() {
  try {
    snapshotActiveTab(sortOrder.value === 'asc' ? 'Sort A→Z' : 'Sort Z→A')
    const next = sortJsonKeys(activeTab.value.content, sortOrder.value, activeTab.value.indent)
    setActiveContent(next)
    notify(
      sortOrder.value === 'asc'
        ? t(locale.value, 'action.sortAsc')
        : t(locale.value, 'action.sortDesc'),
      'success',
    )
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Sort failed', 'error')
  }
}

function handleToggleEscape() {
  try {
    snapshotActiveTab(escapedState.value ? 'Unescape' : 'Escape')
    const next = escapedState.value
      ? unescapeJsonString(activeTab.value.content)
      : escapeJsonString(activeTab.value.content)
    setActiveContent(next)
    escapedState.value = !escapedState.value
    notify(
      escapedState.value ? t(locale.value, 'action.escape') : t(locale.value, 'action.unescape'),
      'success',
    )
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Escape toggle failed', 'error')
  }
}

async function handleCopy(text: string) {
  try {
    if (typeof window !== 'undefined' && window.utools?.copyText) {
      window.utools.copyText(text)
    } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    }
    notify(t(locale.value, 'action.copied'), 'success')
  } catch {
    notify(locale.value === 'en' ? 'Copy failed' : '复制失败', 'error')
  }
}

function handleOpenFile() {
  if (typeof window !== 'undefined' && window.funjson?.openFile) {
    try {
      const file = window.funjson.openFile()
      if (file) {
        const format = detectFormat(file.content, file.name)
        openNewTab({ content: file.content, format, filename: file.name, title: file.name })
        notify(`${locale.value === 'en' ? 'Opened' : '已打开'} ${file.name}`, 'success')
      }
      return
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Open failed', 'error')
      return
    }
  }
  fileInputRef.value?.click()
}

async function handleBrowserFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const content = await file.text()
    const format = detectFormat(content, file.name)
    openNewTab({ content, format, filename: file.name, title: file.name })
    notify(`${locale.value === 'en' ? 'Opened' : '已打开'} ${file.name}`, 'success')
  } catch {
    notify(locale.value === 'en' ? 'Failed to read file' : '读取文件失败', 'error')
  } finally {
    input.value = ''
  }
}

function handleExportFile(payload?: { filename: string; content: string }) {
  const ext = getFormatMeta(activeTab.value.format).ext
  const filename =
    payload?.filename ?? activeTab.value.filename ?? `${activeTab.value.title || 'funjson'}.${ext}`
  const content = payload?.content ?? activeTab.value.content

  if (typeof window !== 'undefined' && window.funjson?.saveFile) {
    try {
      const saved = window.funjson.saveFile(filename, content)
      if (saved) notify(`${locale.value === 'en' ? 'Exported' : '已导出'} ${filename}`, 'success')
      return
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Export failed', 'error')
      return
    }
  }

  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    notify(`${locale.value === 'en' ? 'Exported' : '已导出'} ${filename}`, 'success')
  } catch {
    notify(locale.value === 'en' ? 'Export failed' : '导出失败', 'error')
  }
}

function handleRestoreHistory(entry: TabHistoryEntry) {
  snapshotActiveTab(locale.value === 'en' ? 'Before Restore' : '恢复前备份')
  updateActiveTab((tab) => ({
    ...tab,
    content: entry.content,
    format: entry.format,
    updatedAt: Date.now(),
  }))
  showHistory.value = false
  notify(locale.value === 'en' ? 'Restored snapshot' : '已恢复历史版本', 'success')
}

function handleApplyFromToolbox(payload: { content: string; format?: DataFormat }) {
  snapshotActiveTab('Toolbox')
  updateActiveTab((tab) => ({
    ...tab,
    content: payload.content,
    format: payload.format ?? tab.format,
    updatedAt: Date.now(),
  }))
  workspace.value.activeTool = null
  notify(locale.value === 'en' ? 'Applied to active tab' : '已写回当前标签', 'success')
}

function cycleTheme() {
  const order: Array<FunJsonSettings['theme']> = ['system', 'light', 'dark']
  const next = order[(order.indexOf(workspace.value.settings.theme) + 1) % order.length]
  workspace.value.settings.theme = next
}

function toggleLocale() {
  workspace.value.settings.locale = workspace.value.settings.locale === 'zh-CN' ? 'en' : 'zh-CN'
}

function switchWorkspace(mode: 'workbench' | 'toolbox') {
  mobileNavOpen.value = false
  if (mode === 'workbench') {
    workspace.value.activeTool = null
  } else {
    workspace.value.activeTool = workspace.value.activeTool ?? 'types'
  }
}

function setViewMode(mode: ViewMode) {
  workspace.value.activeTool = null
  workspace.value.viewMode = mode
}

function ingestTextPayload(raw: string, preferFormat?: DataFormat, autoFormat = false) {
  const text = raw
  const format = preferFormat ?? detectFormat(text)
  let finalContent = text
  if (autoFormat) {
    try {
      finalContent = formatContent(text, format, workspace.value.settings.defaultIndent)
    } catch {
      finalContent = text
    }
  }
  const title = autoTabName(finalContent, format, 'Clipboard')
  if (activeTab.value.content.trim()) {
    openNewTab({ content: finalContent, format, title })
  } else {
    updateActiveTab((tab) => ({
      ...tab,
      title,
      format,
      content: finalContent,
      diffRight: finalContent,
      updatedAt: Date.now(),
    }))
    workspace.value.activeTool = null
  }
  workspace.value.viewMode = 'code'
}

function handlePluginEnter(action: { code: string; type: string; payload: unknown }) {
  if (!action) return
  if (action.code === 'json-regex' && typeof action.payload === 'string') {
    ingestTextPayload(action.payload, 'json', true)
    return
  }
  if (action.code === 'json-over' && typeof action.payload === 'string') {
    ingestTextPayload(action.payload, undefined, false)
    return
  }
  if (
    action.code === 'json-files' &&
    Array.isArray(action.payload) &&
    window.funjson?.readEntryFiles
  ) {
    const files = window.funjson.readEntryFiles(action.payload as Array<string | { path?: string }>)
    for (const file of files) {
      const format = detectFormat(file.content, file.name)
      openNewTab({ content: file.content, format, filename: file.name, title: file.name })
    }
    return
  }
  if (action.code === 'funjson') {
    workspace.value.activeTool = null
  }
}

async function handleDrop(event: DragEvent) {
  dragOver.value = false
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files).slice(0, 5)) {
    try {
      const content = await file.text()
      const format = detectFormat(content, file.name)
      openNewTab({ content, format, filename: file.name, title: file.name })
    } catch {
      // ignore unreadable dropped file
    }
  }
}

function handleKeydown(event: KeyboardEvent) {
  const mod = event.metaKey || event.ctrlKey
  if (!mod) return
  const key = event.key.toLowerCase()
  if (event.shiftKey && key === 'f') {
    event.preventDefault()
    if (!inToolbox.value) handleFormat()
  } else if (key === 'k') {
    event.preventDefault()
    handleCommandTrigger()
  } else if (key === 't') {
    event.preventDefault()
    openNewTab()
  }
}

let mediaQuery: MediaQueryList | null = null
const onMediaChange = (e: MediaQueryListEvent) => {
  prefersDark.value = e.matches
}

function handleDocumentClick() {
  if (showSampleMenu.value) showSampleMenu.value = false
}

onMounted(() => {
  applyThemeAttribute()
  registerFunJsonAiTools()

  if (typeof window !== 'undefined' && window.funjson?.onEnter) {
    unsubscribeEnter = window.funjson.onEnter(handlePluginEnter)
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener?.('change', onMediaChange)
  }
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  unsubscribeEnter?.()
  mediaQuery?.removeEventListener?.('change', onMediaChange)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('click', handleDocumentClick)
  if (toastTimer) clearTimeout(toastTimer)
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div
    class="workbench"
    :class="{ 'is-dragover': dragOver, 'sidebar-collapsed': sidebarCollapsed }"
    @dragover.prevent="dragOver = true"
    @dragleave.self="dragOver = false"
    @drop.prevent="handleDrop"
  >
    <!-- Mobile backdrop when drawer open -->
    <div
      v-if="mobileNavOpen"
      class="mobile-nav-backdrop"
      @click="mobileNavOpen = false"
    />

    <!-- Left Collapsible Studio Navigation Sidebar -->
    <aside
      class="workbench-nav"
      :class="{ collapsed: sidebarCollapsed, 'mobile-open': mobileNavOpen }"
      aria-label="Primary navigation"
    >
      <div class="nav-brand">
        <div class="brand-badge">
          <img :src="logoUrl" alt="JSON工坊" class="brand-logo" />
        </div>
        <div v-show="!sidebarCollapsed" class="brand-text">
          <span class="brand-name">{{ t(locale, 'app.name') }}</span>
          <span class="brand-sub">FunJSON</span>
        </div>
        <button
          type="button"
          class="icon-btn nav-collapse-btn"
          :title="sidebarCollapsed ? (locale === 'en' ? 'Expand sidebar' : '展开侧栏') : (locale === 'en' ? 'Collapse sidebar' : '收起侧栏')"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <AppIcon name="panel-left" :size="15" />
        </button>
      </div>

      <div class="nav-body">
        <div v-show="!sidebarCollapsed" class="nav-section-label">
          {{ locale === 'en' ? 'WORKSPACE' : '工作区' }}
        </div>

        <button
          type="button"
          class="nav-link"
          :class="{ active: !inToolbox }"
          data-testid="ws-workbench-btn"
          :title="locale === 'en' ? 'Workbench' : '工作台'"
          @click="switchWorkspace('workbench')"
        >
          <span class="nav-icon">
            <AppIcon name="braces" :size="15" />
          </span>
          <span v-show="!sidebarCollapsed" class="nav-label">
            {{ locale === 'en' ? 'Workbench' : '工作台' }}
          </span>
          <span v-show="!sidebarCollapsed && !inToolbox" class="nav-active-dot" />
        </button>

        <button
          type="button"
          class="nav-link"
          :class="{ active: inToolbox }"
          data-testid="ws-toolbox-btn"
          :title="locale === 'en' ? 'Toolbox' : '工具箱'"
          @click="switchWorkspace('toolbox')"
        >
          <span class="nav-icon">
            <AppIcon name="blocks" :size="15" />
          </span>
          <span v-show="!sidebarCollapsed" class="nav-label">
            {{ locale === 'en' ? 'Toolbox' : '工具箱' }}
          </span>
          <span v-show="!sidebarCollapsed && inToolbox" class="nav-active-dot" />
        </button>
      </div>

      <div class="nav-utilities" :class="{ stacked: sidebarCollapsed }">
        <button
          type="button"
          class="icon-btn"
          data-testid="history-btn"
          :title="t(locale, 'action.history')"
          :aria-label="t(locale, 'action.history')"
          @click="showHistory = true"
        >
          <AppIcon name="history" :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          data-testid="theme-btn"
          :title="t(locale, 'settings.theme')"
          :aria-label="t(locale, 'settings.theme')"
          @click="cycleTheme"
        >
          <AppIcon :name="themeIcon" :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn locale-icon-btn"
          data-testid="locale-toggle-btn"
          :title="t(locale, 'settings.locale')"
          :aria-label="t(locale, 'settings.locale')"
          @click="toggleLocale"
        >
          <span>{{ locale === 'zh-CN' ? '中' : 'EN' }}</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          data-testid="settings-btn"
          :title="t(locale, 'action.settings')"
          :aria-label="t(locale, 'action.settings')"
          @click="showSettings = true"
        >
          <AppIcon name="settings" :size="15" />
        </button>
      </div>
    </aside>

    <!-- Right Workspace Frame -->
    <div class="workspace-frame">
      <!-- Top Browser-Style Tab Bar -->
      <header class="workspace-tab-bar">
        <button
          type="button"
          class="icon-btn mobile-menu-btn"
          :aria-label="locale === 'en' ? 'Toggle navigation' : '切换导航'"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <AppIcon name="panel-left" :size="15" />
        </button>

        <div class="tabs-strip" role="tablist">
          <div
            v-for="tab in workspace.tabs"
            :key="tab.id"
            class="tab-item"
            :class="{ active: !inToolbox && tab.id === activeTab.id }"
            role="tab"
            :aria-selected="!inToolbox && tab.id === activeTab.id"
            :data-testid="`tab-${tab.id}`"
            @click="
              workspace.activeTabId = tab.id;
              workspace.activeTool = null;
            "
            @dblclick="startRename(tab)"
          >
            <span class="tab-fmt mono">{{ getFormatMeta(tab.format).shortLabel }}</span>
            <input
              v-if="renamingTabId === tab.id"
              v-model="renameDraft"
              type="text"
              class="tab-rename-input"
              @click.stop
              @blur="commitRename(tab.id)"
              @keydown.enter="commitRename(tab.id)"
              @keydown.esc="renamingTabId = null"
            />
            <span v-else class="tab-title">{{ tab.title }}</span>
            <button
              type="button"
              class="tab-close"
              :aria-label="t(locale, 'action.closeTab')"
              @click.stop="closeTab(tab.id)"
            >
              <AppIcon name="x" :size="11" />
            </button>
          </div>

          <button
            type="button"
            class="icon-btn new-tab-btn"
            data-testid="new-tab-btn"
            :title="t(locale, 'action.newTab')"
            :aria-label="t(locale, 'action.newTab')"
            @click="openNewTab()"
          >
            <AppIcon name="plus" :size="14" />
          </button>

          <div class="sample-wrap" @click.stop>
            <button
              type="button"
              class="ghost-btn xs sample-trigger"
              data-testid="sample-menu-btn"
              @click="showSampleMenu = !showSampleMenu"
            >
              <span>{{ locale === 'en' ? 'Samples' : '示例' }}</span>
              <AppIcon name="chevron-down" :size="12" />
            </button>
            <div v-if="showSampleMenu" class="sample-menu">
              <button type="button" class="menu-item" @click="loadSample('json')">
                <span class="menu-badge mono">JSON</span>
                <span>{{ locale === 'en' ? 'Users & Nested Data' : '多级嵌套 JSON 示例' }}</span>
              </button>
              <button type="button" class="menu-item" @click="loadSample('json5')">
                <span class="menu-badge mono">JSON5</span>
                <span>{{ locale === 'en' ? 'Comments & Trailing Commas' : '含注释与尾逗号 JSON5' }}</span>
              </button>
              <button type="button" class="menu-item" @click="loadSample('broken')">
                <span class="menu-badge mono">FIX</span>
                <span>{{ locale === 'en' ? 'Broken JSON Repair Demo' : '畸形 JSON 修复示例' }}</span>
              </button>
              <button type="button" class="menu-item" @click="loadSample('ndjson')">
                <span class="menu-badge mono">NDJSON</span>
                <span>{{ locale === 'en' ? 'Newline-Delimited Logs' : 'NDJSON 日志流示例' }}</span>
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="command-trigger"
          :class="{ active: !inToolbox && workspace.viewMode === 'code' && jsonPathOpen }"
          data-testid="toggle-jsonpath-btn"
          :title="locale === 'en' ? 'JSONPath Query (⌘K)' : 'JSONPath 查询 (⌘K)'"
          @click="handleCommandTrigger"
        >
          <AppIcon name="search" :size="12" />
          <span class="cmd-label">JSONPath</span>
          <kbd class="cmd-kbd">⌘K</kbd>
        </button>
      </header>

      <!-- Document Action Bar (Workbench only) -->
      <div v-if="!inToolbox" class="action-bar">
        <div class="seg-control view-switch" role="tablist">
          <button
            v-for="tab in VIEW_TABS"
            :key="tab.id"
            type="button"
            class="seg-btn"
            :class="{ active: workspace.viewMode === tab.id }"
            :data-testid="`view-${tab.id}`"
            @click="setViewMode(tab.id)"
          >
            <AppIcon :name="tab.icon" :size="13" />
            <span>{{ t(locale, `nav.${tab.id}`) }}</span>
          </button>
        </div>

        <div class="action-buttons">
          <button
            type="button"
            class="ghost-btn accent xs"
            data-testid="btn-format"
            :title="`${t(locale, 'action.format')} (⌘⇧F)`"
            @click="handleFormat"
          >
            <AppIcon name="wand" :size="13" />
            <span>{{ t(locale, 'action.format') }}</span>
          </button>
          <button
            type="button"
            class="ghost-btn xs"
            data-testid="btn-minify"
            :title="t(locale, 'action.minify')"
            @click="handleMinify"
          >
            <AppIcon name="minimize" :size="13" />
            <span>{{ t(locale, 'action.minify') }}</span>
          </button>
          <button
            v-if="isJsonLike"
            type="button"
            class="ghost-btn xs"
            data-testid="btn-repair"
            :title="locale === 'en' ? 'Repair JSON' : '修复 JSON'"
            @click="handleRepair"
          >
            <AppIcon name="sparkles" :size="13" />
            <span>{{ locale === 'en' ? 'Repair' : '修复' }}</span>
          </button>

          <span class="toolbar-sep" />

          <button
            v-if="isJsonLike"
            type="button"
            class="ghost-btn icon-only"
            data-testid="btn-sort"
            :title="sortOrder === 'asc' ? t(locale, 'action.sortAsc') : t(locale, 'action.sortDesc')"
            :aria-label="sortOrder === 'asc' ? t(locale, 'action.sortAsc') : t(locale, 'action.sortDesc')"
            @click="handleSortKeys"
          >
            <AppIcon name="arrow-up-down" :size="14" />
          </button>
          <button
            v-if="isJsonLike"
            type="button"
            class="ghost-btn icon-only"
            :class="{ active: escapedState }"
            data-testid="btn-escape"
            :title="escapedState ? t(locale, 'action.unescape') : t(locale, 'action.escape')"
            :aria-label="escapedState ? t(locale, 'action.unescape') : t(locale, 'action.escape')"
            @click="handleToggleEscape"
          >
            <AppIcon name="quote" :size="14" />
          </button>
          <button
            type="button"
            class="ghost-btn icon-only"
            :title="t(locale, 'action.open')"
            :aria-label="t(locale, 'action.open')"
            @click="handleOpenFile"
          >
            <AppIcon name="upload" :size="14" />
          </button>
          <button
            type="button"
            class="ghost-btn icon-only"
            :title="t(locale, 'action.save')"
            :aria-label="t(locale, 'action.save')"
            @click="handleExportFile()"
          >
            <AppIcon name="download" :size="14" />
          </button>
          <button
            type="button"
            class="ghost-btn icon-only"
            :title="t(locale, 'action.copy')"
            :aria-label="t(locale, 'action.copy')"
            @click="handleCopy(activeTab.content)"
          >
            <AppIcon name="copy" :size="14" />
          </button>
        </div>
      </div>

      <!-- Main Workspace Pane -->
      <main class="main-pane">
        <ToolboxView
          v-if="inToolbox"
          :active-tool="currentTool"
          :current-content="activeTab.content"
          :current-format="activeTab.format"
          :indent="activeTab.indent"
          :settings="workspace.settings"
          @update:active-tool="workspace.activeTool = $event"
          @apply-to-tab="handleApplyFromToolbox"
          @open-new-tab="openNewTab($event)"
          @copy="handleCopy"
          @export="handleExportFile($event)"
          @notify="notify($event.message, $event.kind)"
        />

        <CodeEditorView
          v-else-if="workspace.viewMode === 'code'"
          ref="codeEditorRef"
          :model-value="activeTab.content"
          :format="activeTab.format"
          :settings="workspace.settings"
          :is-dark="effectiveDark"
          :json-path-open="jsonPathOpen"
          @update:model-value="setActiveContent"
          @update:json-path-open="jsonPathOpen = $event"
          @request-repair="handleRepair"
          @open-new-tab="openNewTab($event)"
          @copy="handleCopy"
          @notify="notify($event.message, $event.kind)"
          @cursor-change="cursorPos = $event"
        />

        <TreeView
          v-else-if="workspace.viewMode === 'tree'"
          :content="activeTab.content"
          :indent="activeTab.indent"
          :settings="workspace.settings"
          @update:content="setActiveContent"
          @request-repair="handleRepair"
          @copy="handleCopy"
        />

        <TableView
          v-else-if="workspace.viewMode === 'table'"
          :content="activeTab.content"
          :settings="workspace.settings"
          @copy="handleCopy"
          @export="handleExportFile($event)"
          @request-repair="handleRepair"
        />

        <ColumnView
          v-else-if="workspace.viewMode === 'columns'"
          :content="activeTab.content"
          :settings="workspace.settings"
          @copy="handleCopy"
          @open-new-tab="openNewTab($event)"
          @request-repair="handleRepair"
        />

        <DiffView
          v-else
          :left="activeTab.content"
          :right="activeTab.diffRight"
          :format="activeTab.format"
          :indent="activeTab.indent"
          :settings="workspace.settings"
          :current-tab-content="activeTab.content"
          @update:left="setActiveContent"
          @update:right="setActiveDiffRight"
          @notify="notify($event.message, $event.kind)"
        />
      </main>

      <!-- Bottom Studio Status Bar -->
      <footer class="workbench-status">
        <div class="status-group">
          <template v-if="jsonValidation">
            <span v-if="jsonValidation.valid" class="status-valid">
              <AppIcon name="check" :size="12" />
              <span>{{ locale === 'en' ? 'Valid JSON' : 'JSON 合法' }}</span>
            </span>
            <button
              v-else
              type="button"
              class="status-error-btn"
              :title="jsonValidation.message"
              @click="handleRepair"
            >
              <AppIcon name="alert-circle" :size="12" />
              <span>
                {{ locale === 'en' ? 'Error' : '错误' }} Ln {{ jsonValidation.line ?? 1 }}:{{ jsonValidation.column ?? 1 }} ·
                {{ locale === 'en' ? 'Repair' : '修复' }}
              </span>
            </button>
            <span class="status-sep">·</span>
          </template>

          <select
            class="status-select mono"
            :value="activeTab.format"
            aria-label="Data format"
            @change="setActiveFormat(($event.target as HTMLSelectElement).value as DataFormat)"
          >
            <option v-for="fmt in DATA_FORMATS" :key="fmt.id" :value="fmt.id">{{ fmt.label }}</option>
          </select>

          <span class="status-sep">·</span>

          <select
            class="status-select"
            :value="activeTab.indent"
            aria-label="Indentation"
            @change="setActiveIndent(($event.target as HTMLSelectElement).value as IndentOption)"
          >
            <option value="2">{{ locale === 'en' ? '2 Spaces' : '2 空格' }}</option>
            <option value="4">{{ locale === 'en' ? '4 Spaces' : '4 空格' }}</option>
            <option value="tab">Tab</option>
          </select>
        </div>

        <div class="status-group">
          <span class="status-item tabular hide-xs">Ln {{ cursorPos.line }}, Col {{ cursorPos.col }}</span>
          <span class="status-sep hide-xs">·</span>
          <span class="status-item tabular">
            {{ activeStats.lines }} {{ locale === 'en' ? 'lines' : '行' }} · {{ activeStats.size }}
          </span>
          <span class="status-sep">·</span>
          <span class="offline-pill">
            <span class="offline-dot" />
            <span>{{ locale === 'en' ? 'Offline' : '离线' }}</span>
          </span>
        </div>
      </footer>
    </div>

    <!-- Hidden browser file picker -->
    <input
      ref="fileInputRef"
      type="file"
      class="sr-only"
      accept=".json,.json5,.jsonc,.ndjson,.jsonl,.txt"
      @change="handleBrowserFilePick"
    />

    <!-- Toast Notification -->
    <div v-if="toast" class="toast-banner" :class="`toast-${toast.kind}`" role="status">
      {{ toast.message }}
    </div>

    <!-- Modals -->
    <HistoryModal
      :open="showHistory"
      :entries="activeTab.history"
      :current-content="activeTab.content"
      :locale="locale"
      @close="showHistory = false"
      @restore="handleRestoreHistory"
    />

    <SettingsModal
      :open="showSettings"
      :settings="workspace.settings"
      @close="showSettings = false"
      @update:settings="workspace.settings = $event"
    />
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  width: 100vw;
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
  background: var(--bg-canvas);
  position: relative;
}

.workbench.is-dragover::after {
  content: '';
  position: fixed;
  inset: 6px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
  pointer-events: none;
  z-index: 80;
}

/* Left Collapsible Studio Navigation Sidebar */
.workbench-nav {
  width: 156px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  transition: width 160ms ease;
  user-select: none;
  z-index: 20;
}

.workbench-nav.collapsed {
  width: 48px;
}

.nav-brand {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.workbench-nav.collapsed .nav-brand {
  justify-content: center;
  padding: 0 6px;
  gap: 0;
}

.workbench-nav.collapsed .brand-badge {
  display: none;
}

.brand-badge {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.brand-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.brand-name {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
  white-space: nowrap;
}

.brand-sub {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.nav-collapse-btn {
  margin-left: auto;
  width: 24px;
  height: 24px;
  color: var(--text-muted);
}

.workbench-nav.collapsed .nav-collapse-btn {
  margin-left: 0;
}

.nav-body {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.workbench-nav.collapsed .nav-body {
  padding: 10px 6px;
  align-items: center;
}

.nav-section-label {
  padding: 2px 8px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  transition: background-color 130ms ease, color 130ms ease;
}

.workbench-nav.collapsed .nav-link {
  width: 34px;
  height: 34px;
  padding: 0;
  justify-content: center;
}

.nav-link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-link.active {
  background: var(--bg-panel);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--border);
}

.nav-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: background-color 130ms ease, color 130ms ease;
}

.nav-link.active .nav-icon {
  background: var(--accent-soft);
  color: var(--accent);
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-active-dot {
  margin-left: auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.nav-utilities {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  gap: 2px;
  flex-shrink: 0;
}

.nav-utilities.stacked {
  flex-direction: column;
  padding: 8px 6px;
  gap: 4px;
}

.locale-icon-btn {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* Right Workspace Frame */
.workspace-frame {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-canvas);
}

/* Top Browser-Style Tab Bar */
.workspace-tab-bar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 0 10px 0 8px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  min-width: 0;
}

.mobile-menu-btn {
  display: none;
  align-self: center;
  flex-shrink: 0;
}

.tabs-strip {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  height: 100%;
  padding-top: 5px;
}

.tabs-strip::-webkit-scrollbar {
  display: none;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  max-width: 170px;
  padding: 0 8px 0 10px;
  border-radius: 7px 7px 0 0;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 120ms ease, color 120ms ease;
}

.tab-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab-item.active {
  background: var(--bg-canvas);
  border-color: var(--border);
  color: var(--text-primary);
  box-shadow: inset 0 2px 0 var(--accent);
}

.tab-fmt {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.tab-rename-input {
  width: 82px;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg-panel);
  font-size: 11.5px;
  outline: none;
}

.tab-close {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  opacity: 0.65;
  flex-shrink: 0;
}

.tab-item:hover .tab-close,
.tab-item.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.new-tab-btn {
  align-self: center;
  margin-left: 2px;
  flex-shrink: 0;
}

.sample-wrap {
  position: relative;
  align-self: center;
  flex-shrink: 0;
}

.sample-trigger {
  color: var(--text-muted);
}

.sample-menu {
  position: fixed;
  top: 40px;
  z-index: 60;
  min-width: 210px;
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  text-align: left;
  font-size: 12px;
  color: var(--text-primary);
}

.menu-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.menu-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.menu-item:hover .menu-badge {
  background: var(--bg-panel);
  color: var(--accent);
}

.command-trigger {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 500;
  flex-shrink: 0;
  transition: border-color 130ms ease, color 130ms ease, background-color 130ms ease;
}

.command-trigger:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.command-trigger.active {
  border-color: var(--border-accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.cmd-kbd {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

/* Document Action Bar */
.action-bar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  min-width: 0;
}

.action-bar::-webkit-scrollbar {
  display: none;
}

.view-switch .seg-btn {
  padding: 0 7px;
  gap: 4px;
  font-size: 11.5px;
}

.action-buttons {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.action-buttons .ghost-btn.xs {
  padding: 0 6px;
  gap: 4px;
}

.action-buttons .ghost-btn.icon-only {
  width: 24px;
  height: 24px;
}

.toolbar-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 3px;
}

/* Main Workspace Pane */
.main-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-canvas);
}

/* Bottom Studio Status Bar */
.workbench-status {
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
}

.status-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  min-width: 0;
}

.status-sep {
  opacity: 0.45;
}

.status-valid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--success);
  font-weight: 600;
}

.status-error-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--danger);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
}

.status-error-btn:hover {
  background: var(--danger-soft);
}

.status-select {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 1px 4px;
  border-radius: 4px;
  cursor: pointer;
  outline: none;
}

.status-select:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.status-item {
  color: var(--text-secondary);
}

.offline-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--success);
  font-weight: 500;
}

.offline-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.toast-banner {
  position: fixed;
  right: 14px;
  bottom: 34px;
  z-index: 100;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-panel);
  color: var(--text-primary);
}

.toast-success {
  border-color: var(--success);
  color: var(--success);
}

.toast-error {
  border-color: var(--danger);
  color: var(--danger);
}

.mobile-nav-backdrop {
  display: none;
}

@media (max-width: 640px) {
  .mobile-menu-btn {
    display: inline-flex;
  }

  .mobile-nav-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(15, 20, 32, 0.35);
    z-index: 35;
  }

  .workbench-nav {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 176px !important;
    transform: translateX(-100%);
    transition: transform 180ms ease;
    z-index: 40;
    box-shadow: var(--shadow-md);
  }

  .workbench-nav.mobile-open {
    transform: translateX(0);
  }

  .nav-collapse-btn {
    display: none;
  }

  .cmd-label,
  .cmd-kbd,
  .hide-xs {
    display: none;
  }

  .action-bar {
    padding: 0 8px;
  }

  .seg-btn {
    padding: 0 7px;
    font-size: 11.5px;
  }
}
</style>
