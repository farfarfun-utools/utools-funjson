<script setup lang="ts">
import { computed, ref } from 'vue'
import { computeDiff } from '../lib/diff'
import { formatContent, type DataFormat, type IndentOption } from '../lib/formats'
import { t } from '../lib/i18n'
import type { FunJsonSettings } from '../lib/storage'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  left: string
  right: string
  format: DataFormat
  indent: IndentOption
  settings: FunJsonSettings
  currentTabContent: string
}>()

const emit = defineEmits<{
  'update:left': [value: string]
  'update:right': [value: string]
  notify: [payload: { message: string; kind?: 'info' | 'success' | 'error' }]
}>()

const semanticJson = ref(true)

const diffResult = computed(() =>
  computeDiff(props.left, props.right, { semanticJson: semanticJson.value }),
)

const totalChanges = computed(
  () => diffResult.value.stats.added + diffResult.value.stats.removed + diffResult.value.stats.modified,
)

function formatBoth() {
  try {
    if (props.left.trim()) {
      emit('update:left', formatContent(props.left, props.format, props.indent))
    }
    if (props.right.trim()) {
      emit('update:right', formatContent(props.right, props.format, props.indent))
    }
    emit('notify', {
      message: props.settings.locale === 'en' ? 'Formatted both sides' : '已格式化两侧内容',
      kind: 'success',
    })
  } catch (err) {
    emit('notify', {
      message: err instanceof Error ? err.message : 'Format failed',
      kind: 'error',
    })
  }
}

function swapSides() {
  const oldLeft = props.left
  const oldRight = props.right
  emit('update:left', oldRight)
  emit('update:right', oldLeft)
}
</script>

<template>
  <div class="diff-view" data-testid="diff-view">
    <div class="diff-toolbar">
      <label class="toggle-chip">
        <input v-model="semanticJson" type="checkbox" />
        <span>{{ t(settings.locale, 'diff.semantic') }}</span>
      </label>

      <button type="button" class="ghost-btn xs" @click="formatBoth">
        <AppIcon name="wand" :size="12" />
        <span>{{ settings.locale === 'en' ? 'Format Both' : '格式化两侧' }}</span>
      </button>
      <button type="button" class="ghost-btn xs" @click="swapSides">
        <AppIcon name="arrows-left-right" :size="12" />
        <span>{{ settings.locale === 'en' ? 'Swap' : '左右交换' }}</span>
      </button>
      <button type="button" class="ghost-btn xs" @click="emit('update:left', currentTabContent)">
        {{ settings.locale === 'en' ? 'Tab → Left' : '当前→左' }}
      </button>
      <button type="button" class="ghost-btn xs" @click="emit('update:right', currentTabContent)">
        {{ settings.locale === 'en' ? 'Tab → Right' : '当前→右' }}
      </button>

      <div class="diff-stats">
        <span v-if="totalChanges === 0" class="badge badge-success">
          <AppIcon name="check" :size="11" />
          <span>{{ settings.locale === 'en' ? 'Identical' : '无差异' }}</span>
        </span>
        <template v-else>
          <span class="badge badge-success">+{{ diffResult.stats.added }}</span>
          <span class="badge badge-danger">-{{ diffResult.stats.removed }}</span>
          <span class="badge badge-warning">~{{ diffResult.stats.modified }}</span>
        </template>
      </div>
    </div>

    <div class="diff-inputs">
      <div class="diff-pane">
        <div class="pane-label">
          <span>{{ settings.locale === 'en' ? 'Original (Left)' : '基准文本（左侧）' }}</span>
        </div>
        <textarea
          :value="left"
          class="code-textarea"
          spellcheck="false"
          aria-label="Diff left input"
          @input="emit('update:left', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <div class="diff-pane">
        <div class="pane-label">
          <span>{{ settings.locale === 'en' ? 'Compare (Right)' : '对比文本（右侧）' }}</span>
        </div>
        <textarea
          :value="right"
          class="code-textarea"
          spellcheck="false"
          aria-label="Diff right input"
          @input="emit('update:right', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
    </div>

    <div class="diff-output">
      <div
        v-for="(row, idx) in diffResult.rows"
        :key="idx"
        class="diff-row mono"
        :class="`row-${row.kind}`"
      >
        <div class="diff-half">
          <span class="ln tabular">{{ row.leftLine ?? '' }}</span>
          <span class="marker">{{ row.kind === 'removed' ? '-' : row.kind === 'modified' ? '~' : ' ' }}</span>
          <span class="code-text">{{ row.leftText }}</span>
        </div>
        <div class="diff-half">
          <span class="ln tabular">{{ row.rightLine ?? '' }}</span>
          <span class="marker">{{ row.kind === 'added' ? '+' : row.kind === 'modified' ? '~' : ' ' }}</span>
          <span class="code-text">{{ row.rightText }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
}

.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.toggle-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  margin-right: 4px;
}

.diff-stats {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.diff-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 38%;
  min-height: 110px;
  border-bottom: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.diff-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.diff-pane:first-child {
  border-right: 1px solid var(--border);
}

.pane-label {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-subtle);
  border-bottom: 1px solid var(--border);
}

.diff-output {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-panel);
  font-size: 12px;
  line-height: 1.5;
}

.diff-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--border);
}

.diff-half {
  display: flex;
  align-items: baseline;
  min-width: 0;
  padding: 1px 6px;
}

.diff-half:first-child {
  border-right: 1px solid var(--border);
}

.ln {
  width: 30px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 6px;
  color: var(--text-muted);
  font-size: 11px;
  user-select: none;
}

.marker {
  width: 14px;
  flex-shrink: 0;
  font-weight: 700;
  text-align: center;
  user-select: none;
}

.code-text {
  white-space: pre-wrap;
  word-break: break-all;
  min-width: 0;
}

.row-added .diff-half:last-child {
  background: var(--diff-add-bg);
  color: var(--diff-add-text);
}

.row-removed .diff-half:first-child {
  background: var(--diff-del-bg);
  color: var(--diff-del-text);
}

.row-modified .diff-half {
  background: var(--diff-mod-bg);
  color: var(--diff-mod-text);
}
</style>
