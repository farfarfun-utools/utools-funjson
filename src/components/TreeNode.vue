<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Locale } from '../lib/i18n'
import AppIcon from './AppIcon.vue'

defineOptions({ name: 'TreeNode' })

const props = defineProps<{
  nodeKey: string | number
  value: unknown
  path: Array<string | number>
  depth: number
  isRoot?: boolean
  searchQuery: string
  expandSignal: number
  expandTarget: boolean
  showColorSwatch: boolean
  locale: Locale
}>()

const emit = defineEmits<{
  'update-value': [payload: { path: Array<string | number>; value: unknown }]
  'delete-node': [path: Array<string | number>]
  'add-child': [payload: { path: Array<string | number>; key?: string; value: unknown }]
  'copy-path': [jsonPath: string]
  'copy-value': [value: unknown]
}>()

const expanded = ref(props.depth < 2)
const editing = ref(false)
const editDraft = ref('')
const adding = ref(false)
const newKeyDraft = ref('')
const newValDraft = ref('')

watch(
  () => props.expandSignal,
  () => {
    expanded.value = props.expandTarget
  },
)

const valueKind = computed<'obj' | 'arr' | 'str' | 'num' | 'bool' | 'null'>(() => {
  if (props.value === null) return 'null'
  if (Array.isArray(props.value)) return 'arr'
  if (typeof props.value === 'object') return 'obj'
  if (typeof props.value === 'string') return 'str'
  if (typeof props.value === 'number') return 'num'
  return 'bool'
})

const isContainer = computed(() => valueKind.value === 'obj' || valueKind.value === 'arr')

const entries = computed<Array<[string | number, unknown]>>(() => {
  if (Array.isArray(props.value)) {
    return props.value.map((v, i) => [i, v])
  }
  if (props.value !== null && typeof props.value === 'object') {
    return Object.entries(props.value as Record<string, unknown>)
  }
  return []
})

const jsonPath = computed(() => {
  let out = '$'
  for (const seg of props.path) {
    if (typeof seg === 'number') {
      out += `[${seg}]`
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) {
      out += `.${seg}`
    } else {
      out += `[${JSON.stringify(seg)}]`
    }
  }
  return out
})

const colorValue = computed(() => {
  if (!props.showColorSwatch || typeof props.value !== 'string') return null
  const s = props.value.trim()
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^rgba?\(/.test(s)) {
    return s
  }
  return null
})

function subtreeMatches(key: string | number, val: unknown, q: string): boolean {
  if (!q) return true
  if (String(key).toLowerCase().includes(q)) return true
  if (val === null || typeof val !== 'object') {
    return String(val).toLowerCase().includes(q)
  }
  if (Array.isArray(val)) {
    return val.some((item, idx) => subtreeMatches(idx, item, q))
  }
  return Object.entries(val as Record<string, unknown>).some(([k, v]) => subtreeMatches(k, v, q))
}

const normalizedQuery = computed(() => props.searchQuery.trim().toLowerCase())

const visible = computed(() => {
  if (!normalizedQuery.value) return true
  return subtreeMatches(props.nodeKey, props.value, normalizedQuery.value)
})

const selfMatched = computed(() => {
  const q = normalizedQuery.value
  if (!q) return false
  if (String(props.nodeKey).toLowerCase().includes(q)) return true
  if (!isContainer.value && String(props.value).toLowerCase().includes(q)) return true
  return false
})

watch(normalizedQuery, (q) => {
  if (q && isContainer.value && visible.value) {
    expanded.value = true
  }
})

function formatPrimitive(val: unknown): string {
  if (val === null) return 'null'
  if (typeof val === 'string') return JSON.stringify(val)
  return String(val)
}

function parseDraftValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return n
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // treat as string
    }
  }
  return raw
}

function startEdit() {
  if (isContainer.value) return
  editDraft.value = typeof props.value === 'string' ? props.value : String(props.value)
  editing.value = true
}

function saveEdit() {
  editing.value = false
  emit('update-value', { path: props.path, value: parseDraftValue(editDraft.value) })
}

function startAdd() {
  expanded.value = true
  newKeyDraft.value = valueKind.value === 'obj' ? 'newKey' : ''
  newValDraft.value = '""'
  adding.value = true
}

function submitAdd() {
  if (valueKind.value === 'obj' && !newKeyDraft.value.trim()) return
  emit('add-child', {
    path: props.path,
    key: valueKind.value === 'obj' ? newKeyDraft.value.trim() : undefined,
    value: parseDraftValue(newValDraft.value),
  })
  adding.value = false
}
</script>

<template>
  <div v-if="visible" class="tree-node">
    <div
      class="tree-row"
      :class="{ matched: selfMatched }"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
    >
      <button
        v-if="isContainer"
        type="button"
        class="caret-btn"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click="expanded = !expanded"
      >
        <AppIcon :name="expanded ? 'chevron-down' : 'chevron-right'" :size="12" />
      </button>
      <span v-else class="caret-spacer" />

      <span class="node-key mono" :class="{ 'is-index': typeof nodeKey === 'number' }">
        {{ typeof nodeKey === 'number' ? `[${nodeKey}]` : nodeKey }}
      </span>
      <span class="node-colon">:</span>

      <span class="type-pill" :class="`t-${valueKind}`">{{ valueKind }}</span>

      <template v-if="isContainer">
        <span class="count-pill tabular mono">
          {{ valueKind === 'arr' ? `[ ${entries.length} ]` : `{ ${entries.length} }` }}
        </span>
      </template>

      <template v-else-if="editing">
        <input
          v-model="editDraft"
          type="text"
          class="field-input mono inline-edit-input"
          @keydown.enter="saveEdit"
          @keydown.esc="editing = false"
        />
        <button type="button" class="pill-btn primary xs" aria-label="Save" @click="saveEdit">
          <AppIcon name="check" :size="12" />
        </button>
        <button type="button" class="pill-btn xs" aria-label="Cancel" @click="editing = false">
          <AppIcon name="x" :size="12" />
        </button>
      </template>

      <template v-else>
        <span
          v-if="colorValue"
          class="color-swatch"
          :style="{ backgroundColor: colorValue }"
          :title="colorValue"
        />
        <button
          type="button"
          class="node-val mono"
          :class="`v-${valueKind}`"
          :title="locale === 'en' ? 'Click to edit' : '点击编辑值'"
          @click="startEdit"
        >
          {{ formatPrimitive(value) }}
        </button>
      </template>

      <div class="row-actions">
        <button
          v-if="isContainer"
          type="button"
          class="act-btn"
          :title="locale === 'en' ? 'Add child' : '添加子节点'"
          @click="startAdd"
        >
          <AppIcon name="plus" :size="11" />
        </button>
        <button
          type="button"
          class="act-btn"
          :title="locale === 'en' ? 'Copy JSONPath' : '复制 JSONPath'"
          @click="emit('copy-path', jsonPath)"
        >
          <AppIcon name="folder-path" :size="11" />
        </button>
        <button
          type="button"
          class="act-btn"
          :title="locale === 'en' ? 'Copy value' : '复制值'"
          @click="emit('copy-value', value)"
        >
          <AppIcon name="copy" :size="11" />
        </button>
        <button
          v-if="!isRoot"
          type="button"
          class="act-btn danger"
          :title="locale === 'en' ? 'Delete node' : '删除节点'"
          @click="emit('delete-node', path)"
        >
          <AppIcon name="x" :size="11" />
        </button>
      </div>
    </div>

    <div
      v-if="adding && isContainer"
      class="add-row"
      :style="{ paddingLeft: `${(depth + 1) * 16 + 24}px` }"
    >
      <input
        v-if="valueKind === 'obj'"
        v-model="newKeyDraft"
        type="text"
        class="field-input mono add-input"
        :placeholder="locale === 'en' ? 'key' : '键名'"
      />
      <input
        v-model="newValDraft"
        type="text"
        class="field-input mono add-input"
        :placeholder="locale === 'en' ? 'value (JSON literal)' : '值（支持 JSON 字面量）'"
        @keydown.enter="submitAdd"
      />
      <button type="button" class="pill-btn primary xs" @click="submitAdd">
        {{ locale === 'en' ? 'Add' : '添加' }}
      </button>
      <button type="button" class="pill-btn xs" @click="adding = false">
        {{ locale === 'en' ? 'Cancel' : '取消' }}
      </button>
    </div>

    <template v-if="isContainer && expanded">
      <TreeNode
        v-for="[childKey, childVal] in entries"
        :key="String(childKey)"
        :node-key="childKey"
        :value="childVal"
        :path="[...path, childKey]"
        :depth="depth + 1"
        :search-query="searchQuery"
        :expand-signal="expandSignal"
        :expand-target="expandTarget"
        :show-color-swatch="showColorSwatch"
        :locale="locale"
        @update-value="emit('update-value', $event)"
        @delete-node="emit('delete-node', $event)"
        @add-child="emit('add-child', $event)"
        @copy-path="emit('copy-path', $event)"
        @copy-value="emit('copy-value', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding-right: 10px;
  border-radius: var(--radius-xs);
  transition: background-color 110ms ease;
}

.tree-row:hover {
  background: var(--bg-hover);
}

.tree-row.matched {
  background: var(--accent-soft);
}

.caret-btn {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.caret-btn:hover {
  color: var(--accent);
}

.caret-spacer {
  width: 16px;
  flex-shrink: 0;
}

.node-key {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--type-obj);
  white-space: nowrap;
}

.node-key.is-index {
  color: var(--type-arr);
}

.node-colon {
  color: var(--text-muted);
}

.type-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  border-radius: 4px;
  text-transform: uppercase;
  flex-shrink: 0;
  background: var(--bg-recessed);
}

.t-obj {
  color: var(--type-obj);
}
.t-arr {
  color: var(--type-arr);
}
.t-str {
  color: var(--type-str);
}
.t-num {
  color: var(--type-num);
}
.t-bool {
  color: var(--type-bool);
}
.t-null {
  color: var(--type-null);
}

.count-pill {
  font-size: 11px;
  color: var(--text-muted);
}

.node-val {
  font-size: 12.5px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
  padding: 1px 4px;
  border-radius: 3px;
}

.node-val:hover {
  background: var(--bg-recessed);
}

.v-str {
  color: var(--type-str);
}
.v-num {
  color: var(--type-num);
}
.v-bool {
  color: var(--type-bool);
  font-weight: 600;
}
.v-null {
  color: var(--type-null);
  font-style: italic;
}

.inline-edit-input {
  height: 22px;
  width: 180px;
  font-size: 12px;
}

.row-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: 0;
  transition: opacity 110ms ease;
}

.tree-row:hover .row-actions,
.tree-row:focus-within .row-actions {
  opacity: 1;
}

.act-btn {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.act-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.act-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  padding-bottom: 4px;
}

.add-input {
  height: 24px;
  width: 130px;
}
</style>
