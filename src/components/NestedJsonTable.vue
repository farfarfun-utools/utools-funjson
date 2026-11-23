<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Locale } from '../lib/i18n'
import {
  collectAllObjectKeys,
  isExpandableValue,
  isObjectArray,
  isPlainObject,
  joinIndexPath,
  joinObjectPath,
  matchesNestedSearch,
} from '../lib/table'
import AppIcon from './AppIcon.vue'

defineOptions({ name: 'NestedJsonTable' })

const props = withDefaults(
  defineProps<{
    data: unknown
    path: string
    depth: number
    expandedPaths: Set<string>
    selectedPath: string | null
    globalFilter: string
    hideEmpty: boolean
    hideNull: boolean
    showColorSwatch?: boolean
    columnFilters?: Record<string, string[]>
    sortCol?: string | null
    sortDir?: 'asc' | 'desc'
    locale: Locale
  }>(),
  {
    showColorSwatch: true,
    columnFilters: undefined,
    sortCol: undefined,
    sortDir: undefined,
  },
)

const emit = defineEmits<{
  'toggle-expand': [path: string]
  'select-path': [path: string]
  copy: [text: string]
  'toggle-sort': [col: string]
  'update-column-filter': [payload: { col: string; values: string[] }]
}>()

// Local sort & column filter state so nested object arrays are also independently sortable & filterable
const localSortCol = ref<string | null>(null)
const localSortDir = ref<'asc' | 'desc'>('asc')
const localColFilters = reactive<Record<string, string[]>>({})
const openFilterCol = ref<string | null>(null)

function closeFilterPopover() {
  if (openFilterCol.value !== null) {
    openFilterCol.value = null
  }
}

function handlePopoverEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') closeFilterPopover()
}

onMounted(() => {
  window.addEventListener('click', closeFilterPopover)
  window.addEventListener('keydown', handlePopoverEscape)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeFilterPopover)
  window.removeEventListener('keydown', handlePopoverEscape)
})

const effectiveSortCol = computed(() =>
  props.sortCol !== undefined ? props.sortCol : localSortCol.value,
)
const effectiveSortDir = computed(() =>
  props.sortDir !== undefined ? props.sortDir : localSortDir.value,
)
const effectiveColumnFilters = computed(() => props.columnFilters ?? localColFilters)

const tableKind = computed<'object-array' | 'plain-object' | 'array' | 'primitive'>(() => {
  if (isObjectArray(props.data)) return 'object-array'
  if (isPlainObject(props.data)) return 'plain-object'
  if (Array.isArray(props.data)) return 'array'
  return 'primitive'
})

const normalizedQuery = computed(() => props.globalFilter.trim().toLowerCase())

function isValueEmptyOrNull(val: unknown): boolean {
  if (props.hideNull && val === null) return true
  if (props.hideEmpty && (val === '' || val === undefined)) return true
  return false
}

function isExpanded(targetPath: string, value: unknown): boolean {
  if (props.expandedPaths.has(targetPath)) return true
  if (normalizedQuery.value && isExpandableValue(value)) {
    return matchesNestedSearch(null, value, normalizedQuery.value)
  }
  return false
}

function isPathSelected(targetPath: string): boolean {
  return props.selectedPath === targetPath
}

function formatPrimitiveLabel(val: unknown): string {
  if (val === undefined) return '—'
  if (val === null) return 'null'
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return '[]'
  if (isPlainObject(val)) return '{}'
  return String(val)
}

function formatFilterOption(val: unknown): string {
  if (val === undefined) return '(empty)'
  if (val === null) return 'null'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function getValueClass(val: unknown): string {
  if (val === undefined) return 'val-undef'
  if (val === null) return 'val-null'
  if (typeof val === 'string') return 'val-str'
  if (typeof val === 'number') return 'val-num'
  if (typeof val === 'boolean') return 'val-bool'
  return 'val-muted'
}

function getColorHex(val: unknown): string | null {
  if (!props.showColorSwatch || typeof val !== 'string') return null
  const s = val.trim()
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^rgba?\(/.test(s)) {
    return s
  }
  return null
}

function getContainerBadge(val: unknown): { kind: 'obj' | 'arr'; text: string } {
  if (Array.isArray(val)) {
    return { kind: 'arr', text: `Array [ ${val.length} ]` }
  }
  const count = isPlainObject(val) ? Object.keys(val).length : 0
  return { kind: 'obj', text: `Object { ${count} }` }
}

function handleCellCopy(val: unknown) {
  if (val === undefined) return
  const str = typeof val === 'string' ? val : JSON.stringify(val, null, 2)
  emit('copy', str)
}

// 1. Plain Object entries
const objectEntries = computed(() => {
  if (tableKind.value !== 'plain-object') return []
  const obj = props.data as Record<string, unknown>
  const q = normalizedQuery.value
  return Object.entries(obj)
    .filter(([k, v]) => {
      if (isValueEmptyOrNull(v)) return false
      if (q && !matchesNestedSearch(k, v, q)) return false
      return true
    })
    .map(([k, v]) => ({
      key: k,
      value: v,
      cellPath: joinObjectPath(props.path, k),
      expandable: isExpandableValue(v),
    }))
})

// 2. Object Array columns & rows
const objectArrayItems = computed<Record<string, unknown>[]>(() =>
  tableKind.value === 'object-array' ? (props.data as Record<string, unknown>[]) : [],
)

const objectArrayColumns = computed(() => {
  const allCols = collectAllObjectKeys(objectArrayItems.value)
  if (!props.hideEmpty && !props.hideNull) return allCols
  return allCols.filter((col) =>
    objectArrayItems.value.some((row) => !isValueEmptyOrNull(row[col])),
  )
})

function uniqueValuesForColumn(col: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of objectArrayItems.value) {
    const label = formatFilterOption(row[col])
    if (!seen.has(label)) {
      seen.add(label)
      out.push(label)
    }
  }
  return out
}

const filteredObjectArrayRows = computed(() => {
  const q = normalizedQuery.value
  const filters = effectiveColumnFilters.value

  let list = objectArrayItems.value
    .map((item, origIndex) => ({
      item,
      origIndex,
      rowPath: joinIndexPath(props.path, origIndex),
    }))
    .filter(({ item, origIndex }) => {
      if (q && !matchesNestedSearch(origIndex, item, q)) return false
      for (const [col, allowed] of Object.entries(filters)) {
        if (allowed && allowed.length > 0) {
          const valLabel = formatFilterOption(item[col])
          if (!allowed.includes(valLabel)) return false
        }
      }
      return true
    })

  const col = effectiveSortCol.value
  if (col) {
    const dir = effectiveSortDir.value === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      const av = a.item[col]
      const bv = b.item[col]
      if (av === bv) return 0
      if (av === undefined || av === null) return 1
      if (bv === undefined || bv === null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir
      }
      return String(av).localeCompare(String(bv)) * dir
    })
  }
  return list
})

function handleSortClick(col: string) {
  if (props.sortCol !== undefined) {
    emit('toggle-sort', col)
    return
  }
  if (localSortCol.value !== col) {
    localSortCol.value = col
    localSortDir.value = 'asc'
  } else if (localSortDir.value === 'asc') {
    localSortDir.value = 'desc'
  } else {
    localSortCol.value = null
  }
}

function toggleFilterValue(col: string, val: string) {
  const current = effectiveColumnFilters.value[col] ?? []
  const next = current.includes(val) ? current.filter((v) => v !== val) : [...current, val]
  if (props.columnFilters !== undefined) {
    emit('update-column-filter', { col, values: next })
  } else if (next.length === 0) {
    delete localColFilters[col]
  } else {
    localColFilters[col] = next
  }
}

function clearColumnFilter(col: string) {
  if (props.columnFilters !== undefined) {
    emit('update-column-filter', { col, values: [] })
  } else {
    delete localColFilters[col]
  }
}

// 3. Primitive / Mixed Array items
const arrayItems = computed(() => {
  if (tableKind.value !== 'array') return []
  const arr = props.data as unknown[]
  const q = normalizedQuery.value
  return arr
    .map((item, idx) => ({
      index: idx,
      value: item,
      cellPath: joinIndexPath(props.path, idx),
      expandable: isExpandableValue(item),
    }))
    .filter(({ index, value }) => {
      if (isValueEmptyOrNull(value)) return false
      if (q && !matchesNestedSearch(index, value, q)) return false
      return true
    })
})
</script>

<template>
  <div class="nested-table-wrap" :class="{ 'is-nested': depth > 0 }">
    <!-- 1. Array of Objects: Multi-column table -->
    <table
      v-if="tableKind === 'object-array'"
      class="nj-table nj-array-table"
      :class="{ 'is-root': depth === 0 }"
    >
      <thead>
        <tr>
          <th class="idx-col">#</th>
          <th v-for="col in objectArrayColumns" :key="col" class="col-th">
            <div class="th-inner">
              <button
                type="button"
                class="th-sort-btn mono"
                :class="{ sorted: effectiveSortCol === col }"
                :title="locale === 'en' ? `Sort by ${col}` : `按 ${col} 排序`"
                @click="handleSortClick(col)"
              >
                <span class="th-label">{{ col }}</span>
                <AppIcon
                  v-if="effectiveSortCol === col"
                  :name="effectiveSortDir === 'asc' ? 'arrow-up' : 'arrow-down'"
                  :size="11"
                />
              </button>

              <div class="th-filter-wrap">
                <button
                  type="button"
                  class="th-filter-btn"
                  :class="{
                    active: (effectiveColumnFilters[col]?.length ?? 0) > 0 || openFilterCol === col,
                  }"
                  :aria-label="`Filter ${col}`"
                  :title="locale === 'en' ? `Filter ${col}` : `筛选 ${col}`"
                  @click.stop="openFilterCol = openFilterCol === col ? null : col"
                >
                  <AppIcon name="filter" :size="11" />
                </button>

                <div v-if="openFilterCol === col" class="filter-popover" @click.stop>
                  <div class="popover-head">
                    <span class="mono">{{ col }}</span>
                    <button
                      type="button"
                      class="popover-clear"
                      @click="clearColumnFilter(col)"
                    >
                      {{ locale === 'en' ? 'Clear' : '清空' }}
                    </button>
                  </div>
                  <div class="popover-list">
                    <label
                      v-for="opt in uniqueValuesForColumn(col)"
                      :key="opt"
                      class="popover-opt"
                    >
                      <input
                        type="checkbox"
                        :checked="(effectiveColumnFilters[col] ?? []).includes(opt)"
                        @change="toggleFilterValue(col, opt)"
                      />
                      <span class="mono">{{ opt }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="filteredObjectArrayRows.length === 0">
          <td :colspan="objectArrayColumns.length + 1" class="empty-cell">
            {{ locale === 'en' ? 'No matching rows' : '无匹配记录' }}
          </td>
        </tr>
        <tr
          v-for="row in filteredObjectArrayRows"
          :key="row.rowPath"
          :class="{ 'row-selected': isPathSelected(row.rowPath) }"
        >
          <td
            class="idx-col tabular"
            @click="emit('select-path', row.rowPath)"
          >
            {{ row.origIndex }}
          </td>
          <td
            v-for="col in objectArrayColumns"
            :key="col"
            class="val-cell"
            :class="{
              'cell-selected': isPathSelected(joinObjectPath(row.rowPath, col)),
              'has-nested': isExpandableValue(row.item[col]) && isExpanded(joinObjectPath(row.rowPath, col), row.item[col]),
            }"
            @click.stop="emit('select-path', joinObjectPath(row.rowPath, col))"
            @dblclick.stop="handleCellCopy(row.item[col])"
          >
            <template v-if="isExpandableValue(row.item[col])">
              <div class="expandable-cell">
                <button
                  type="button"
                  class="expand-toggle"
                  :class="getContainerBadge(row.item[col]).kind === 'obj' ? 'pill-obj' : 'pill-arr'"
                  :data-table-path="joinObjectPath(row.rowPath, col)"
                  @click.stop="
                    emit('toggle-expand', joinObjectPath(row.rowPath, col));
                    emit('select-path', joinObjectPath(row.rowPath, col));
                  "
                >
                  <AppIcon
                    :name="
                      isExpanded(joinObjectPath(row.rowPath, col), row.item[col])
                        ? 'chevron-down'
                        : 'chevron-right'
                    "
                    :size="12"
                  />
                  <span class="mono">{{ getContainerBadge(row.item[col]).text }}</span>
                </button>
                <div
                  v-if="isExpanded(joinObjectPath(row.rowPath, col), row.item[col])"
                  class="nested-slot"
                >
                  <NestedJsonTable
                    :data="row.item[col]"
                    :path="joinObjectPath(row.rowPath, col)"
                    :depth="depth + 1"
                    :expanded-paths="expandedPaths"
                    :selected-path="selectedPath"
                    :global-filter="globalFilter"
                    :hide-empty="hideEmpty"
                    :hide-null="hideNull"
                    :show-color-swatch="showColorSwatch"
                    :locale="locale"
                    @toggle-expand="emit('toggle-expand', $event)"
                    @select-path="emit('select-path', $event)"
                    @copy="emit('copy', $event)"
                  />
                </div>
              </div>
            </template>

            <template v-else-if="isValueEmptyOrNull(row.item[col])">
              <span class="val-undef mono">—</span>
            </template>

            <template v-else>
              <span class="prim-inline">
                <span
                  v-if="getColorHex(row.item[col])"
                  class="color-swatch"
                  :style="{ backgroundColor: getColorHex(row.item[col])! }"
                />
                <span
                  class="prim-val mono"
                  :class="getValueClass(row.item[col])"
                  :title="formatPrimitiveLabel(row.item[col])"
                >
                  {{ formatPrimitiveLabel(row.item[col]) }}
                </span>
              </span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 2. Plain Object: Key | Value table -->
    <table
      v-else-if="tableKind === 'plain-object'"
      class="nj-table nj-kv-table"
      :class="{ 'is-root': depth === 0 }"
    >
      <thead v-if="depth === 0">
        <tr>
          <th class="kv-key-th">{{ locale === 'en' ? 'Key' : '键 (Key)' }}</th>
          <th>{{ locale === 'en' ? 'Value' : '值 (Value)' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="objectEntries.length === 0">
          <td colspan="2" class="empty-cell">
            {{ locale === 'en' ? 'No matching fields' : '无匹配字段' }}
          </td>
        </tr>
        <tr
          v-for="entry in objectEntries"
          :key="entry.cellPath"
          :class="{ 'row-selected': isPathSelected(entry.cellPath) }"
        >
          <td
            class="kv-key mono"
            @click.stop="emit('select-path', entry.cellPath)"
          >
            {{ entry.key }}
          </td>
          <td
            class="val-cell"
            :class="{
              'cell-selected': isPathSelected(entry.cellPath),
              'has-nested': entry.expandable && isExpanded(entry.cellPath, entry.value),
            }"
            @click.stop="emit('select-path', entry.cellPath)"
            @dblclick.stop="handleCellCopy(entry.value)"
          >
            <template v-if="entry.expandable">
              <div class="expandable-cell">
                <button
                  type="button"
                  class="expand-toggle"
                  :class="getContainerBadge(entry.value).kind === 'obj' ? 'pill-obj' : 'pill-arr'"
                  :data-table-path="entry.cellPath"
                  @click.stop="
                    emit('toggle-expand', entry.cellPath);
                    emit('select-path', entry.cellPath);
                  "
                >
                  <AppIcon
                    :name="isExpanded(entry.cellPath, entry.value) ? 'chevron-down' : 'chevron-right'"
                    :size="12"
                  />
                  <span class="mono">{{ getContainerBadge(entry.value).text }}</span>
                </button>
                <div v-if="isExpanded(entry.cellPath, entry.value)" class="nested-slot">
                  <NestedJsonTable
                    :data="entry.value"
                    :path="entry.cellPath"
                    :depth="depth + 1"
                    :expanded-paths="expandedPaths"
                    :selected-path="selectedPath"
                    :global-filter="globalFilter"
                    :hide-empty="hideEmpty"
                    :hide-null="hideNull"
                    :show-color-swatch="showColorSwatch"
                    :locale="locale"
                    @toggle-expand="emit('toggle-expand', $event)"
                    @select-path="emit('select-path', $event)"
                    @copy="emit('copy', $event)"
                  />
                </div>
              </div>
            </template>

            <template v-else>
              <span class="prim-inline">
                <span
                  v-if="getColorHex(entry.value)"
                  class="color-swatch"
                  :style="{ backgroundColor: getColorHex(entry.value)! }"
                />
                <span
                  class="prim-val mono"
                  :class="getValueClass(entry.value)"
                  :title="formatPrimitiveLabel(entry.value)"
                >
                  {{ formatPrimitiveLabel(entry.value) }}
                </span>
              </span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 3. Primitive / Mixed Array: # | Value table -->
    <table
      v-else-if="tableKind === 'array'"
      class="nj-table nj-kv-table"
      :class="{ 'is-root': depth === 0 }"
    >
      <thead v-if="depth === 0">
        <tr>
          <th class="idx-col">#</th>
          <th>{{ locale === 'en' ? 'Value' : '元素值' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="arrayItems.length === 0">
          <td colspan="2" class="empty-cell">
            {{ locale === 'en' ? 'Empty array' : '空数组' }}
          </td>
        </tr>
        <tr
          v-for="item in arrayItems"
          :key="item.cellPath"
          :class="{ 'row-selected': isPathSelected(item.cellPath) }"
        >
          <td class="idx-col tabular" @click.stop="emit('select-path', item.cellPath)">
            {{ item.index }}
          </td>
          <td
            class="val-cell"
            :class="{
              'cell-selected': isPathSelected(item.cellPath),
              'has-nested': item.expandable && isExpanded(item.cellPath, item.value),
            }"
            @click.stop="emit('select-path', item.cellPath)"
            @dblclick.stop="handleCellCopy(item.value)"
          >
            <template v-if="item.expandable">
              <div class="expandable-cell">
                <button
                  type="button"
                  class="expand-toggle"
                  :class="getContainerBadge(item.value).kind === 'obj' ? 'pill-obj' : 'pill-arr'"
                  :data-table-path="item.cellPath"
                  @click.stop="
                    emit('toggle-expand', item.cellPath);
                    emit('select-path', item.cellPath);
                  "
                >
                  <AppIcon
                    :name="isExpanded(item.cellPath, item.value) ? 'chevron-down' : 'chevron-right'"
                    :size="12"
                  />
                  <span class="mono">{{ getContainerBadge(item.value).text }}</span>
                </button>
                <div v-if="isExpanded(item.cellPath, item.value)" class="nested-slot">
                  <NestedJsonTable
                    :data="item.value"
                    :path="item.cellPath"
                    :depth="depth + 1"
                    :expanded-paths="expandedPaths"
                    :selected-path="selectedPath"
                    :global-filter="globalFilter"
                    :hide-empty="hideEmpty"
                    :hide-null="hideNull"
                    :show-color-swatch="showColorSwatch"
                    :locale="locale"
                    @toggle-expand="emit('toggle-expand', $event)"
                    @select-path="emit('select-path', $event)"
                    @copy="emit('copy', $event)"
                  />
                </div>
              </div>
            </template>

            <template v-else>
              <span class="prim-inline">
                <span
                  v-if="getColorHex(item.value)"
                  class="color-swatch"
                  :style="{ backgroundColor: getColorHex(item.value)! }"
                />
                <span
                  class="prim-val mono"
                  :class="getValueClass(item.value)"
                  :title="formatPrimitiveLabel(item.value)"
                >
                  {{ formatPrimitiveLabel(item.value) }}
                </span>
              </span>
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 4. Scalar Root Fallback -->
    <div v-else class="scalar-box mono" :class="getValueClass(data)">
      {{ formatPrimitiveLabel(data) }}
    </div>
  </div>
</template>

<style scoped>
.nested-table-wrap {
  width: 100%;
  min-width: 0;
}

.nested-table-wrap.is-nested {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
}

.nj-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  line-height: 1.45;
  background: var(--bg-canvas);
}

.nj-table.is-root {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: visible;
}

.nj-kv-table.is-root {
  table-layout: fixed;
}

.nj-table thead th {
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 11.5px;
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  white-space: nowrap;
  vertical-align: middle;
}

.nj-table.is-root > thead > tr > th {
  position: sticky;
  top: 0;
  z-index: 4;
}

.nj-table thead th:last-child,
.nj-table tbody td:last-child {
  border-right: none;
}

.nj-table tbody td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  vertical-align: top;
  transition: background-color 110ms ease;
}

.nj-table tbody tr:last-child > td {
  border-bottom: none;
}

.nj-table tbody tr:hover > td:not(.has-nested) {
  background: var(--bg-surface);
}

.nj-table tbody tr.row-selected > td.kv-key,
.nj-table tbody tr.row-selected > td.idx-col {
  background: var(--accent-soft);
  color: var(--accent);
}

.nj-table tbody td.cell-selected {
  box-shadow: inset 0 0 0 1.5px var(--accent);
  background: var(--accent-soft);
}

.idx-col {
  width: 34px;
  min-width: 34px;
  text-align: center !important;
  color: var(--text-muted);
  font-size: 11px;
  background: var(--bg-muted);
  user-select: none;
  cursor: pointer;
}

.kv-key-th {
  width: 124px;
  min-width: 108px;
}

.kv-key {
  width: 124px;
  min-width: 108px;
  max-width: 168px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.col-th {
  position: relative;
}

.th-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}

.th-sort-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 11.5px;
  padding: 1px 2px;
  border-radius: 3px;
}

.th-sort-btn:hover,
.th-sort-btn.sorted {
  color: var(--accent);
}

.th-filter-wrap {
  position: relative;
  display: inline-flex;
}

.th-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--text-muted);
  opacity: 0.65;
  transition: all 120ms ease;
}

.th-filter-btn:hover,
.th-filter-btn.active {
  opacity: 1;
  background: var(--accent-soft);
  color: var(--accent);
}

.filter-popover {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  z-index: 40;
  min-width: 168px;
  max-width: 240px;
  background: var(--bg-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 6px;
  font-weight: 400;
}

.popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 6px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}

.popover-clear {
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}

.popover-clear:hover {
  text-decoration: underline;
}

.popover-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
  padding-top: 4px;
}

.popover-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px;
  border-radius: 4px;
  font-size: 11.5px;
  color: var(--text-primary);
  cursor: pointer;
}

.popover-opt:hover {
  background: var(--bg-hover);
}

.popover-opt span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.val-cell {
  cursor: pointer;
  min-width: 72px;
}

.expandable-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
}

.expand-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px 0 5px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.expand-toggle.pill-obj {
  background: var(--pill-obj-bg);
  color: var(--pill-obj-text);
  border-color: var(--pill-obj-border);
}

.expand-toggle.pill-arr {
  background: var(--pill-arr-bg);
  color: var(--pill-arr-text);
  border-color: var(--pill-arr-border);
}

.expand-toggle:hover {
  filter: brightness(0.96);
}

.nested-slot {
  width: 100%;
  min-width: 0;
}

.prim-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}

.prim-val {
  display: inline-block;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.val-str {
  color: var(--type-str);
}

.val-num {
  color: var(--type-num);
  font-variant-numeric: tabular-nums;
}

.val-bool {
  color: var(--type-bool);
  font-weight: 600;
}

.val-null {
  color: var(--type-null);
  font-style: italic;
}

.val-undef,
.val-muted {
  color: var(--text-muted);
}

.empty-cell {
  text-align: center;
  color: var(--text-muted);
  padding: 12px !important;
  font-size: 12px;
}

.scalar-box {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  font-size: 13px;
}
</style>
