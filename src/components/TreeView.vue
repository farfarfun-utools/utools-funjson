<script setup lang="ts">
import { computed, ref } from 'vue'
import { indentToString, parseJsonLike, type IndentOption } from '../lib/formats'
import type { FunJsonSettings } from '../lib/storage'
import AppIcon from './AppIcon.vue'
import TreeNode from './TreeNode.vue'

const props = defineProps<{
  content: string
  indent: IndentOption
  settings: FunJsonSettings
}>()

const emit = defineEmits<{
  'update:content': [value: string]
  'request-repair': []
  copy: [text: string]
}>()

const searchQuery = ref('')
const expandSignal = ref(0)
const expandTarget = ref(true)

const parsedState = computed<{ ok: true; data: unknown } | { ok: false; error: string }>(() => {
  try {
    return { ok: true, data: parseJsonLike(props.content) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
  }
})

function countNodes(val: unknown): number {
  if (val === null || typeof val !== 'object') return 1
  if (Array.isArray(val)) return 1 + val.reduce<number>((acc, item) => acc + countNodes(item), 0)
  return (
    1 +
    Object.values(val as Record<string, unknown>).reduce<number>((acc, item) => acc + countNodes(item), 0)
  )
}

const totalNodes = computed(() => (parsedState.value.ok ? countNodes(parsedState.value.data) : 0))

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function commitData(nextData: unknown) {
  emit('update:content', JSON.stringify(nextData, null, indentToString(props.indent)))
}

function handleUpdateValue(payload: { path: Array<string | number>; value: unknown }) {
  if (!parsedState.value.ok) return
  if (payload.path.length === 0) {
    commitData(payload.value)
    return
  }
  const cloned = cloneData(parsedState.value.data)
  let cursor: any = cloned
  for (let i = 0; i < payload.path.length - 1; i += 1) {
    cursor = cursor[payload.path[i]]
  }
  cursor[payload.path[payload.path.length - 1]] = payload.value
  commitData(cloned)
}

function handleDeleteNode(path: Array<string | number>) {
  if (!parsedState.value.ok || path.length === 0) return
  const cloned = cloneData(parsedState.value.data)
  let cursor: any = cloned
  for (let i = 0; i < path.length - 1; i += 1) {
    cursor = cursor[path[i]]
  }
  const leaf = path[path.length - 1]
  if (Array.isArray(cursor) && typeof leaf === 'number') {
    cursor.splice(leaf, 1)
  } else if (cursor && typeof cursor === 'object') {
    delete cursor[leaf]
  }
  commitData(cloned)
}

function handleAddChild(payload: { path: Array<string | number>; key?: string; value: unknown }) {
  if (!parsedState.value.ok) return
  const cloned = cloneData(parsedState.value.data)
  let cursor: any = cloned
  for (const seg of payload.path) {
    cursor = cursor[seg]
  }
  if (Array.isArray(cursor)) {
    cursor.push(payload.value)
  } else if (cursor && typeof cursor === 'object' && payload.key) {
    cursor[payload.key] = payload.value
  }
  commitData(cloned)
}

function expandAll() {
  expandTarget.value = true
  expandSignal.value += 1
}

function collapseAll() {
  expandTarget.value = false
  expandSignal.value += 1
}

function handleCopyValue(val: unknown) {
  const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
  emit('copy', str)
}
</script>

<template>
  <div class="tree-view" data-testid="tree-view">
    <div class="tree-toolbar">
      <div class="tree-search-box">
        <AppIcon name="search" :size="13" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          class="tree-search-input"
          :placeholder="settings.locale === 'en' ? 'Filter keys or values...' : '搜索键名或节点值...'"
          aria-label="Filter tree"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="search-clear"
          :aria-label="settings.locale === 'en' ? 'Clear search' : '清空搜索'"
          @click="searchQuery = ''"
        >
          <AppIcon name="x" :size="12" />
        </button>
      </div>
      <button type="button" class="ghost-btn xs" @click="expandAll">
        <AppIcon name="fold-down" :size="13" />
        <span>{{ settings.locale === 'en' ? 'Expand All' : '全部展开' }}</span>
      </button>
      <button type="button" class="ghost-btn xs" @click="collapseAll">
        <AppIcon name="fold-up" :size="13" />
        <span>{{ settings.locale === 'en' ? 'Collapse All' : '全部折叠' }}</span>
      </button>
      <span v-if="parsedState.ok" class="badge badge-neutral tabular tree-count">
        {{ totalNodes }} {{ settings.locale === 'en' ? 'nodes' : '个节点' }}
      </span>
    </div>

    <div v-if="parsedState.ok" class="tree-scroll">
      <TreeNode
        node-key="$"
        :value="parsedState.data"
        :path="[]"
        :depth="0"
        is-root
        :search-query="searchQuery"
        :expand-signal="expandSignal"
        :expand-target="expandTarget"
        :show-color-swatch="settings.smartDisplay.colorSwatch"
        :locale="settings.locale"
        @update-value="handleUpdateValue"
        @delete-node="handleDeleteNode"
        @add-child="handleAddChild"
        @copy-path="emit('copy', $event)"
        @copy-value="handleCopyValue"
      />
    </div>

    <div v-else class="empty-state">
      <p class="empty-title">
        {{ settings.locale === 'en' ? 'Unable to parse JSON for Tree View' : '当前内容无法解析为 JSON 树' }}
      </p>
      <p class="empty-desc mono">{{ parsedState.error }}</p>
      <button type="button" class="pill-btn primary" @click="emit('request-repair')">
        {{ settings.locale === 'en' ? 'Repair JSON' : '一键修复 JSON' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tree-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-canvas);
}

.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.tree-search-box {
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 240px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-canvas);
}

.tree-search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.search-icon {
  color: var(--text-muted);
  margin-right: 6px;
}

.tree-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
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

.tree-count {
  margin-left: auto;
}

.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 6px;
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
  font-size: 14px;
  font-weight: 600;
}

.empty-desc {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
  max-width: 460px;
}
</style>
