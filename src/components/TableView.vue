<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { parseJsonLike } from '../lib/formats'
import type { FunJsonSettings } from '../lib/storage'
import {
  collectAllExpandablePaths,
  collectDefaultExpandedPaths,
  exportValueAsTable,
  getNodeByTablePath,
  isPlainObject,
  tablePathToJsonPath,
} from '../lib/table'
import AppIcon from './AppIcon.vue'
import NestedJsonTable from './NestedJsonTable.vue'

const props = defineProps<{
  content: string
  settings: FunJsonSettings
}>()

const emit = defineEmits<{
  copy: [text: string]
  export: [payload: { filename: string; content: string }]
  'request-repair': []
}>()

const globalQuery = ref('')
const filterMode = ref<'all' | 'hide-empty' | 'hide-null'>('all')
const expandedPaths = ref<Set<string>>(new Set())
const selectedPath = ref<string>('root')

const parsedState = computed<{ ok: true; data: unknown } | { ok: false; error: string }>(() => {
  try {
    return { ok: true, data: parseJsonLike(props.content) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON input' }
  }
})

watch(
  () => props.content,
  () => {
    if (parsedState.value.ok) {
      expandedPaths.value = new Set(collectDefaultExpandedPaths(parsedState.value.data, 1))
      selectedPath.value = 'root'
    } else {
      expandedPaths.value = new Set()
      selectedPath.value = 'root'
    }
  },
  { immediate: true },
)

const selectedNodeInfo = computed(() => {
  if (!parsedState.value.ok) return null
  const resolved = getNodeByTablePath(parsedState.value.data, selectedPath.value)
  const value = resolved.found ? resolved.value : parsedState.value.data
  const path = resolved.found ? selectedPath.value : 'root'
  const jsonPath = tablePathToJsonPath(path)

  let summary = ''
  if (Array.isArray(value)) {
    summary =
      props.settings.locale === 'en'
        ? `Array · ${value.length} items`
        : `Array · ${value.length} 项`
  } else if (isPlainObject(value)) {
    const count = Object.keys(value).length
    summary =
      props.settings.locale === 'en'
        ? `Object · ${count} keys`
        : `Object · ${count} 字段`
  } else if (value === null) {
    summary = 'null'
  } else {
    summary = typeof value
  }

  return { path, jsonPath, value, summary }
})

function toggleExpand(path: string) {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  expandedPaths.value = next
}

function handleExpandAll() {
  if (!parsedState.value.ok) return
  expandedPaths.value = new Set(collectAllExpandablePaths(parsedState.value.data))
}

function handleCollapseAll() {
  expandedPaths.value = new Set()
}

function handleSelectPath(path: string) {
  selectedPath.value = path
}

function handleCopySelectedNode() {
  if (!selectedNodeInfo.value) return
  const val = selectedNodeInfo.value.value
  const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
  emit('copy', text)
}

function handleExport(format: 'csv' | 'tsv' | 'markdown' | 'json') {
  if (!selectedNodeInfo.value) return
  const targetVal = selectedNodeInfo.value.value
  const out = exportValueAsTable(targetVal, format)
  const ext = format === 'markdown' ? 'md' : format
  emit('export', { filename: `funjson-table.${ext}`, content: out })
}
</script>

<template>
  <div class="table-view" data-testid="table-view">
    <!-- Top Table Operation Bar -->
    <div class="table-toolbar">
      <div class="search-box">
        <AppIcon name="search" :size="13" class="search-icon" />
        <input
          v-model="globalQuery"
          type="text"
          class="search-input"
          :placeholder="settings.locale === 'en' ? 'Search nested keys & values...' : '全局搜索嵌套键名与值...'"
          aria-label="Global table search"
        />
        <button
          v-if="globalQuery"
          type="button"
          class="search-clear"
          :aria-label="settings.locale === 'en' ? 'Clear search' : '清空搜索'"
          @click="globalQuery = ''"
        >
          <AppIcon name="x" :size="12" />
        </button>
      </div>

      <div class="toolbar-group">
        <button
          type="button"
          class="ghost-btn xs"
          data-testid="table-expand-all"
          :title="settings.locale === 'en' ? 'Expand all nested tables' : '展开全部嵌套表'"
          :disabled="!parsedState.ok"
          @click="handleExpandAll"
        >
          <AppIcon name="fold-down" :size="13" />
          <span>{{ settings.locale === 'en' ? 'Expand' : '展开' }}</span>
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          data-testid="table-collapse-all"
          :title="settings.locale === 'en' ? 'Collapse all nested tables' : '折叠全部嵌套表'"
          :disabled="!parsedState.ok"
          @click="handleCollapseAll"
        >
          <AppIcon name="fold-up" :size="13" />
          <span>{{ settings.locale === 'en' ? 'Collapse' : '折叠' }}</span>
        </button>
      </div>

      <div class="seg-control compact-seg" role="group" aria-label="Cell visibility filter">
        <button
          type="button"
          class="seg-btn"
          :class="{ active: filterMode === 'all' }"
          @click="filterMode = 'all'"
        >
          {{ settings.locale === 'en' ? 'All' : '全部' }}
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ active: filterMode === 'hide-empty' }"
          @click="filterMode = 'hide-empty'"
        >
          {{ settings.locale === 'en' ? 'No Empty' : '隐空值' }}
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ active: filterMode === 'hide-null' }"
          @click="filterMode = 'hide-null'"
        >
          {{ settings.locale === 'en' ? 'No Null' : '隐 null' }}
        </button>
      </div>

      <div class="export-group">
        <span class="export-label" :title="settings.locale === 'en' ? 'Export selected table' : '导出当前选中表'">
          <AppIcon name="download" :size="12" />
        </span>
        <button type="button" class="ghost-btn xs" :disabled="!parsedState.ok" @click="handleExport('csv')">
          CSV
        </button>
        <button type="button" class="ghost-btn xs" :disabled="!parsedState.ok" @click="handleExport('tsv')">
          TSV
        </button>
        <button type="button" class="ghost-btn xs" :disabled="!parsedState.ok" @click="handleExport('markdown')">
          MD
        </button>
        <button type="button" class="ghost-btn xs" :disabled="!parsedState.ok" @click="handleExport('json')">
          JSON
        </button>
      </div>
    </div>

    <!-- JSONPath Breadcrumb Bar -->
    <div v-if="parsedState.ok && selectedNodeInfo" class="path-bar" data-testid="table-path-bar">
      <div class="path-left">
        <AppIcon name="folder-path" :size="13" class="path-icon" />
        <code class="path-code mono" data-testid="table-selected-path">{{ selectedNodeInfo.jsonPath }}</code>
        <span class="badge badge-neutral tabular">{{ selectedNodeInfo.summary }}</span>
      </div>

      <div class="path-actions">
        <button
          v-if="selectedPath !== 'root'"
          type="button"
          class="ghost-btn xs"
          @click="selectedPath = 'root'"
        >
          $
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          @click="emit('copy', selectedNodeInfo.jsonPath)"
        >
          <AppIcon name="copy" :size="12" />
          <span>{{ settings.locale === 'en' ? 'Copy Path' : '复制路径' }}</span>
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          @click="handleCopySelectedNode"
        >
          <AppIcon name="braces" :size="12" />
          <span>{{ settings.locale === 'en' ? 'Copy Node' : '复制节点' }}</span>
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="!parsedState.ok" class="empty-state">
      <AppIcon name="alert-circle" :size="24" class="err-icon" />
      <p class="empty-title">
        {{ settings.locale === 'en' ? 'Cannot render nested table from invalid JSON' : '当前内容无法解析为嵌套表格' }}
      </p>
      <p class="mono err-text">{{ parsedState.error }}</p>
      <button type="button" class="pill-btn primary" @click="emit('request-repair')">
        <AppIcon name="sparkles" :size="13" />
        <span>{{ settings.locale === 'en' ? 'Repair JSON' : '一键修复 JSON' }}</span>
      </button>
    </div>

    <!-- Recursive Nested Table Canvas -->
    <div v-else class="table-canvas" @click="selectedPath = 'root'">
      <NestedJsonTable
        :data="parsedState.data"
        path="root"
        :depth="0"
        :expanded-paths="expandedPaths"
        :selected-path="selectedPath"
        :global-filter="globalQuery"
        :hide-empty="filterMode === 'hide-empty'"
        :hide-null="filterMode === 'hide-null'"
        :show-color-swatch="settings.smartDisplay.colorSwatch"
        :locale="settings.locale"
        @toggle-expand="toggleExpand"
        @select-path="handleSelectPath"
        @copy="emit('copy', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.table-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-canvas);
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 118px;
  max-width: 158px;
  height: 25px;
  padding: 0 7px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-canvas);
  transition: border-color 130ms ease, box-shadow 130ms ease;
}

.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.search-icon {
  color: var(--text-muted);
  margin-right: 5px;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-primary);
}

.search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  width: 16px;
  height: 16px;
  border-radius: 3px;
}

.search-clear:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.compact-seg {
  padding: 2px;
}

.compact-seg .seg-btn {
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
}

.export-group {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.export-group .ghost-btn.xs {
  padding: 0 5px;
  font-size: 11px;
}

.export-label {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  margin-right: 2px;
}

.path-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
  flex-shrink: 0;
  min-height: 30px;
}

.path-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
}

.path-icon {
  color: var(--accent);
}

.path-code {
  font-size: 11.5px;
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.table-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 14px;
  background: var(--bg-canvas);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
}

.empty-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
}

.err-icon {
  color: var(--danger);
}

.err-text {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  max-width: 460px;
}
</style>
