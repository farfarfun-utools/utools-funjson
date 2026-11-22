<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { computeDiff } from '../lib/diff'
import type { Locale } from '../lib/i18n'
import type { TabHistoryEntry } from '../lib/storage'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  open: boolean
  entries: TabHistoryEntry[]
  currentContent: string
  locale: Locale
}>()

const emit = defineEmits<{
  close: []
  restore: [entry: TabHistoryEntry]
}>()

const selectedId = ref<string | null>(null)

watch(
  () => [props.open, props.entries],
  () => {
    if (props.open && props.entries.length > 0) {
      if (!selectedId.value || !props.entries.some((e) => e.id === selectedId.value)) {
        selectedId.value = props.entries[0].id
      }
    }
  },
  { immediate: true },
)

const selectedEntry = computed(
  () => props.entries.find((e) => e.id === selectedId.value) ?? props.entries[0] ?? null,
)

const diffPreview = computed(() =>
  selectedEntry.value ? computeDiff(selectedEntry.value.content, props.currentContent) : null,
)

function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat(props.locale === 'en' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toLocaleTimeString()
  }
}

function formatSize(content: string): string {
  const bytes = new TextEncoder().encode(content).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" data-testid="history-modal" @click.self="emit('close')">
    <div class="modal-card history-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">
          {{ locale === 'en' ? 'Tab History Snapshots' : '当前标签历史快照' }}
        </h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="emit('close')">
          <AppIcon name="x" :size="15" />
        </button>
      </div>

      <div v-if="entries.length === 0" class="modal-body empty-hist">
        <p>{{ locale === 'en' ? 'No history snapshots yet for this tab.' : '当前标签暂无历史快照（执行格式化或转换前会自动保存）。' }}</p>
      </div>

      <div v-else class="history-split">
        <div class="hist-list">
          <button
            v-for="entry in entries"
            :key="entry.id"
            type="button"
            class="hist-item"
            :class="{ active: selectedEntry?.id === entry.id }"
            @click="selectedId = entry.id"
          >
            <div class="hist-row-top">
              <span class="hist-label">{{ entry.label || (locale === 'en' ? 'Snapshot' : '快照') }}</span>
              <span class="badge badge-neutral tabular">{{ formatSize(entry.content) }}</span>
            </div>
            <div class="hist-time tabular">{{ formatTime(entry.timestamp) }}</div>
          </button>
        </div>

        <div v-if="selectedEntry && diffPreview" class="hist-preview">
          <div class="preview-bar">
            <span class="badge badge-neutral">{{ selectedEntry.format.toUpperCase() }}</span>
            <span class="badge badge-success">+{{ diffPreview.stats.added }}</span>
            <span class="badge badge-danger">-{{ diffPreview.stats.removed }}</span>
            <span class="badge badge-warning">~{{ diffPreview.stats.modified }}</span>
          </div>
          <div class="diff-box mono">
            <div
              v-for="(row, idx) in diffPreview.rows"
              :key="idx"
              class="hdiff-row"
              :class="`hrow-${row.kind}`"
            >
              <div class="hdiff-col">
                <span class="hln tabular">{{ row.leftLine ?? '' }}</span>
                <span>{{ row.leftText }}</span>
              </div>
              <div class="hdiff-col">
                <span class="hln tabular">{{ row.rightLine ?? '' }}</span>
                <span>{{ row.rightText }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="pill-btn" @click="emit('close')">
          {{ locale === 'en' ? 'Close' : '关闭' }}
        </button>
        <button
          v-if="selectedEntry"
          type="button"
          class="pill-btn primary"
          @click="emit('restore', selectedEntry)"
        >
          {{ locale === 'en' ? 'Restore This Version' : '恢复此版本' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-card {
  max-width: 720px;
  height: 480px;
}

.empty-hist {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.history-split {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.hist-list {
  width: 210px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hist-item {
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  text-align: left;
}

.hist-item:hover {
  background: var(--bg-hover);
}

.hist-item.active {
  background: var(--accent-soft);
  border-color: var(--border-accent);
}

.hist-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.hist-label {
  font-size: 12px;
  font-weight: 600;
}

.hist-time {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.hist-preview {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}

.diff-box {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 11.5px;
}

.hdiff-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--border);
}

.hdiff-col {
  display: flex;
  gap: 6px;
  padding: 2px 6px;
  white-space: pre-wrap;
  word-break: break-all;
}

.hdiff-col:first-child {
  border-right: 1px solid var(--border);
}

.hln {
  width: 22px;
  text-align: right;
  color: var(--text-muted);
  flex-shrink: 0;
}

.hrow-added .hdiff-col:last-child {
  background: var(--diff-add-bg);
  color: var(--diff-add-text);
}

.hrow-removed .hdiff-col:first-child {
  background: var(--diff-del-bg);
  color: var(--diff-del-text);
}

.hrow-modified .hdiff-col {
  background: var(--diff-mod-bg);
  color: var(--diff-mod-text);
}
</style>
