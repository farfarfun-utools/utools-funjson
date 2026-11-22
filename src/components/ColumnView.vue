<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { inspectToken } from '../lib/decoders'
import { parseJsonLike, type DataFormat } from '../lib/formats'
import type { FunJsonSettings } from '../lib/storage'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  content: string
  settings: FunJsonSettings
}>()

const emit = defineEmits<{
  copy: [text: string]
  'open-new-tab': [payload: { content: string; format: DataFormat; title?: string }]
  'request-repair': []
}>()

const selectedPath = ref<Array<string | number>>([])

const parsedState = computed<{ ok: true; data: unknown } | { ok: false; error: string }>(() => {
  try {
    return { ok: true, data: parseJsonLike(props.content) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
  }
})

watch(
  () => props.content,
  () => {
    // Keep path valid if structure changed
    if (!parsedState.value.ok) {
      selectedPath.value = []
      return
    }
    let cur: any = parsedState.value.data
    const validPath: Array<string | number> = []
    for (const seg of selectedPath.value) {
      if (cur !== null && typeof cur === 'object' && seg in cur) {
        cur = cur[seg]
        validPath.push(seg)
      } else {
        break
      }
    }
    selectedPath.value = validPath
  },
)

interface ColumnEntry {
  key: string | number
  value: unknown
  kind: 'obj' | 'arr' | 'str' | 'num' | 'bool' | 'null'
  summary: string
  isContainer: boolean
}

function classify(val: unknown): {
  kind: ColumnEntry['kind']
  summary: string
  isContainer: boolean
} {
  if (val === null) return { kind: 'null', summary: 'null', isContainer: false }
  if (Array.isArray(val)) return { kind: 'arr', summary: `[ ${val.length} ]`, isContainer: true }
  if (typeof val === 'object') {
    return { kind: 'obj', summary: `{ ${Object.keys(val).length} }`, isContainer: true }
  }
  if (typeof val === 'string') return { kind: 'str', summary: val, isContainer: false }
  if (typeof val === 'number') return { kind: 'num', summary: String(val), isContainer: false }
  return { kind: 'bool', summary: String(val), isContainer: false }
}

function toEntries(val: unknown): ColumnEntry[] {
  if (Array.isArray(val)) {
    return val.map((item, idx) => ({ key: idx, value: item, ...classify(item) }))
  }
  if (val !== null && typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: v,
      ...classify(v),
    }))
  }
  return []
}

const columns = computed<Array<{ depth: number; selectedKey?: string | number; entries: ColumnEntry[] }>>(() => {
  if (!parsedState.value.ok) return []
  const cols: Array<{ depth: number; selectedKey?: string | number; entries: ColumnEntry[] }> = []
  let current: unknown = parsedState.value.data
  if (current === null || typeof current !== 'object') return []

  cols.push({
    depth: 0,
    selectedKey: selectedPath.value[0],
    entries: toEntries(current),
  })

  for (let i = 0; i < selectedPath.value.length; i += 1) {
    const seg = selectedPath.value[i]
    current = (current as any)?.[seg]
    if (current !== null && typeof current === 'object') {
      cols.push({
        depth: i + 1,
        selectedKey: selectedPath.value[i + 1],
        entries: toEntries(current),
      })
    } else {
      break
    }
  }
  return cols
})

const inspectedValue = computed(() => {
  if (!parsedState.value.ok) return undefined
  let cur: any = parsedState.value.data
  for (const seg of selectedPath.value) {
    if (cur !== null && typeof cur === 'object' && seg in cur) {
      cur = cur[seg]
    }
  }
  return cur
})

const currentJsonPath = computed(() => {
  let out = '$'
  for (const seg of selectedPath.value) {
    if (typeof seg === 'number') out += `[${seg}]`
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) out += `.${seg}`
    else out += `[${JSON.stringify(seg)}]`
  }
  return out
})

const formattedInspectorValue = computed(() => {
  const v = inspectedValue.value
  if (v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
})

const tokenDecodings = computed(() => {
  const v = inspectedValue.value
  if (typeof v === 'string' || typeof v === 'number') {
    return inspectToken(String(v), props.settings.timeZone)
  }
  return []
})

function selectItem(depth: number, key: string | number) {
  selectedPath.value = [...selectedPath.value.slice(0, depth), key]
}

function jumpBreadcrumb(index: number) {
  if (index < 0) {
    selectedPath.value = []
  } else {
    selectedPath.value = selectedPath.value.slice(0, index + 1)
  }
}
</script>

<template>
  <div class="column-view" data-testid="column-view">
    <div class="breadcrumb-bar">
      <button type="button" class="crumb-btn mono" @click="jumpBreadcrumb(-1)">$</button>
      <template v-for="(seg, idx) in selectedPath" :key="`${idx}-${seg}`">
        <AppIcon name="chevron-right" :size="12" class="crumb-sep" />
        <button type="button" class="crumb-btn mono" @click="jumpBreadcrumb(idx)">
          {{ typeof seg === 'number' ? `[${seg}]` : seg }}
        </button>
      </template>
      <button
        type="button"
        class="ghost-btn xs crumb-copy"
        @click="emit('copy', currentJsonPath)"
      >
        <AppIcon name="copy" :size="12" />
        <span>{{ settings.locale === 'en' ? 'Copy Path' : '复制路径' }}</span>
      </button>
    </div>

    <div v-if="parsedState.ok" class="miller-layout">
      <div class="miller-columns">
        <div
          v-for="col in columns"
          :key="col.depth"
          class="miller-col"
        >
          <button
            v-for="entry in col.entries"
            :key="String(entry.key)"
            type="button"
            class="miller-item"
            :class="{ active: col.selectedKey === entry.key }"
            @click="selectItem(col.depth, entry.key)"
          >
            <span class="item-key mono">
              {{ typeof entry.key === 'number' ? `[${entry.key}]` : entry.key }}
            </span>
            <span class="item-meta mono" :class="`k-${entry.kind}`">
              {{ entry.summary }}
            </span>
            <AppIcon v-if="entry.isContainer" name="chevron-right" :size="12" class="item-arrow" />
          </button>
        </div>
      </div>

      <aside class="miller-inspector">
        <div class="inspector-head">
          <span class="badge badge-accent mono">{{ currentJsonPath }}</span>
          <span class="badge badge-neutral">{{ classify(inspectedValue).kind }}</span>
        </div>

        <pre class="inspector-code mono">{{ formattedInspectorValue }}</pre>

        <div v-if="tokenDecodings.length > 0" class="inspector-decoders">
          <div
            v-for="(item, idx) in tokenDecodings"
            :key="`${item.kind}-${idx}`"
            class="decoder-card"
          >
            <div class="decoder-head">
              <span class="badge badge-accent">{{ item.label }}</span>
              <span
                v-if="item.previewColor"
                class="color-swatch"
                :style="{ backgroundColor: item.previewColor }"
              />
            </div>
            <div class="decoder-val mono">{{ item.value }}</div>
            <div v-if="item.detail" class="decoder-detail">{{ item.detail }}</div>
            <div class="decoder-actions">
              <button type="button" class="pill-btn xs" @click="emit('copy', item.value)">
                {{ settings.locale === 'en' ? 'Copy' : '复制' }}
              </button>
              <button
                v-if="item.kind === 'json-string'"
                type="button"
                class="pill-btn soft xs"
                @click="
                  emit('open-new-tab', {
                    content: item.value,
                    format: 'json',
                    title: 'Embedded JSON',
                  })
                "
              >
                {{ settings.locale === 'en' ? 'Open in Tab' : '新标签打开' }}
              </button>
            </div>
          </div>
        </div>

        <div class="inspector-actions">
          <button type="button" class="pill-btn xs" @click="emit('copy', currentJsonPath)">
            {{ settings.locale === 'en' ? 'Copy JSONPath' : '复制 JSONPath' }}
          </button>
          <button type="button" class="pill-btn primary xs" @click="emit('copy', formattedInspectorValue)">
            {{ settings.locale === 'en' ? 'Copy Value' : '复制值' }}
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="empty-state">
      <p>{{ settings.locale === 'en' ? 'Invalid JSON for Column View' : '当前内容无法解析为栏列视图' }}</p>
      <p class="mono err-text">{{ parsedState.error }}</p>
      <button type="button" class="pill-btn primary" @click="emit('request-repair')">
        {{ settings.locale === 'en' ? 'Repair JSON' : '一键修复 JSON' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.column-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
}

.breadcrumb-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  overflow-x: auto;
  flex-shrink: 0;
}

.crumb-btn {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.crumb-btn:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.crumb-sep {
  color: var(--text-muted);
}

.crumb-copy {
  margin-left: auto;
}

.miller-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.miller-columns {
  flex: 1;
  min-width: 0;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
}

.miller-col {
  width: 200px;
  min-width: 170px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.miller-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  text-align: left;
  transition: background-color 110ms ease;
}

.miller-item:hover {
  background: var(--bg-hover);
}

.miller-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.item-key {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  margin-left: auto;
  font-size: 11px;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.k-str {
  color: var(--type-str);
}
.k-num {
  color: var(--type-num);
}
.k-bool {
  color: var(--type-bool);
}
.k-obj {
  color: var(--type-obj);
}
.k-arr {
  color: var(--type-arr);
}

.item-arrow {
  color: var(--text-muted);
  font-size: 13px;
}

.miller-inspector {
  width: 245px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-subtle);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.inspector-code {
  margin: 0;
  padding: 8px;
  flex: 1;
  min-height: 90px;
  overflow: auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.inspector-decoders {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.decoder-card {
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-accent);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.decoder-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.decoder-val {
  font-size: 11.5px;
  word-break: break-all;
}

.decoder-detail {
  font-size: 11px;
  color: var(--text-secondary);
}

.decoder-actions,
.inspector-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}

.err-text {
  color: var(--danger);
  font-size: 12px;
}

@media (max-width: 600px) {
  .miller-layout {
    flex-direction: column;
  }
  .miller-inspector {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: 220px;
  }
}
</style>
