<script setup lang="ts">
import { t } from '../lib/i18n'
import type { FunJsonSettings } from '../lib/storage'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  open: boolean
  settings: FunJsonSettings
}>()

const emit = defineEmits<{
  close: []
  'update:settings': [next: FunJsonSettings]
}>()

const TIMEZONES = [
  'Asia/Shanghai',
  'UTC',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
]

function patch(partial: Partial<FunJsonSettings>) {
  emit('update:settings', {
    ...props.settings,
    ...partial,
  })
}

function patchSmart(partial: Partial<FunJsonSettings['smartDisplay']>) {
  emit('update:settings', {
    ...props.settings,
    smartDisplay: {
      ...props.settings.smartDisplay,
      ...partial,
    },
  })
}

function patchAi(partial: Partial<FunJsonSettings['ai']>) {
  emit('update:settings', {
    ...props.settings,
    ai: {
      ...props.settings.ai,
      ...partial,
    },
  })
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" data-testid="settings-modal" @click.self="emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3 class="modal-title">{{ t(settings.locale, 'action.settings') }}</h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="emit('close')">
          <AppIcon name="x" :size="15" />
        </button>
      </div>

      <div class="modal-body settings-body">
        <!-- Appearance & Locale -->
        <div class="setting-section">
          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.theme') }}</span>
            <div class="seg-control">
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.theme === 'system' }"
                @click="patch({ theme: 'system' })"
              >
                {{ t(settings.locale, 'settings.themeSystem') }}
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.theme === 'light' }"
                @click="patch({ theme: 'light' })"
              >
                {{ t(settings.locale, 'settings.themeLight') }}
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.theme === 'dark' }"
                @click="patch({ theme: 'dark' })"
              >
                {{ t(settings.locale, 'settings.themeDark') }}
              </button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.locale') }}</span>
            <div class="seg-control">
              <button
                type="button"
                class="seg-btn"
                data-testid="locale-zh-btn"
                :class="{ active: settings.locale === 'zh-CN' }"
                @click="patch({ locale: 'zh-CN' })"
              >
                简体中文
              </button>
              <button
                type="button"
                class="seg-btn"
                data-testid="locale-en-btn"
                :class="{ active: settings.locale === 'en' }"
                @click="patch({ locale: 'en' })"
              >
                English
              </button>
            </div>
          </div>
        </div>

        <!-- Editor Preferences -->
        <div class="setting-section">
          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.indent') }}</span>
            <div class="seg-control">
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.defaultIndent === '2' }"
                @click="patch({ defaultIndent: '2' })"
              >
                2 Spaces
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.defaultIndent === '4' }"
                @click="patch({ defaultIndent: '4' })"
              >
                4 Spaces
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ active: settings.defaultIndent === 'tab' }"
                @click="patch({ defaultIndent: 'tab' })"
              >
                Tab
              </button>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.fontSize') }}</span>
            <div class="font-size-control">
              <input
                type="range"
                min="12"
                max="16"
                step="1"
                :value="settings.fontSize"
                @input="patch({ fontSize: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="badge badge-neutral tabular">{{ settings.fontSize }}px</span>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.wordWrap') }}</span>
            <label class="switch-label">
              <input
                type="checkbox"
                :checked="settings.wordWrap"
                @change="patch({ wordWrap: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.wordWrap ? (settings.locale === 'en' ? 'On' : '开启') : (settings.locale === 'en' ? 'Off' : '关闭') }}</span>
            </label>
          </div>

          <div class="setting-row">
            <span class="setting-label">{{ settings.locale === 'en' ? 'Time Zone' : '时间戳时区' }}</span>
            <select
              class="pill-select"
              :value="settings.timeZone"
              @change="patch({ timeZone: ($event.target as HTMLSelectElement).value })"
            >
              <option v-if="!TIMEZONES.includes(settings.timeZone)" :value="settings.timeZone">
                {{ settings.timeZone }}
              </option>
              <option v-for="tz in TIMEZONES" :key="tz" :value="tz">{{ tz }}</option>
            </select>
          </div>
        </div>

        <!-- Smart Display Toggles -->
        <div class="setting-section">
          <div class="section-heading">
            {{ settings.locale === 'en' ? 'Smart Inspector & Display' : '智能解码与辅助展示' }}
          </div>
          <div class="smart-grid">
            <label class="check-item">
              <input
                type="checkbox"
                :checked="settings.smartDisplay.embeddedJson"
                @change="patchSmart({ embeddedJson: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.locale === 'en' ? 'Embedded JSON String' : '嵌套 JSON 字符串' }}</span>
            </label>
            <label class="check-item">
              <input
                type="checkbox"
                :checked="settings.smartDisplay.colorSwatch"
                @change="patchSmart({ colorSwatch: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.locale === 'en' ? 'Color Swatch Preview' : '颜色色块预览' }}</span>
            </label>
            <label class="check-item">
              <input
                type="checkbox"
                :checked="settings.smartDisplay.timestamp"
                @change="patchSmart({ timestamp: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.locale === 'en' ? 'Unix Timestamp' : '时间戳自动解码' }}</span>
            </label>
            <label class="check-item">
              <input
                type="checkbox"
                :checked="settings.smartDisplay.base64"
                @change="patchSmart({ base64: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.locale === 'en' ? 'Base64 Text Decode' : 'Base64 自动解码' }}</span>
            </label>
            <label class="check-item">
              <input
                type="checkbox"
                :checked="settings.smartDisplay.foldSummary"
                @change="patchSmart({ foldSummary: ($event.target as HTMLInputElement).checked })"
              />
              <span>{{ settings.locale === 'en' ? 'Fold Summary' : '折叠节点摘要' }}</span>
            </label>
          </div>
        </div>

        <!-- AI Repair Configuration -->
        <div class="setting-section">
          <div class="setting-row">
            <span class="setting-label">{{ t(settings.locale, 'settings.aiProvider') }}</span>
            <select
              class="pill-select"
              :value="settings.ai.provider"
              @change="patchAi({ provider: ($event.target as HTMLSelectElement).value as FunJsonSettings['ai']['provider'] })"
            >
              <option value="local">{{ t(settings.locale, 'settings.aiLocal') }}</option>
              <option value="utools-ai">{{ t(settings.locale, 'settings.aiUtools') }}</option>
              <option value="openai">{{ t(settings.locale, 'settings.aiOpenai') }}</option>
            </select>
          </div>

          <div v-if="settings.ai.provider === 'openai'" class="openai-fields">
            <div class="field-group">
              <label class="mini-label">Base URL</label>
              <input
                type="text"
                class="field-input mono"
                :value="settings.ai.baseUrl"
                placeholder="https://api.openai.com/v1"
                @input="patchAi({ baseUrl: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-group">
              <label class="mini-label">Model</label>
              <input
                type="text"
                class="field-input mono"
                :value="settings.ai.model"
                placeholder="gpt-4o-mini"
                @input="patchAi({ model: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field-group">
              <label class="mini-label">API Key</label>
              <input
                type="password"
                class="field-input mono"
                :value="settings.ai.apiKey"
                placeholder="sk-..."
                @input="patchAi({ apiKey: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="pill-btn primary" @click="emit('close')">
          {{ settings.locale === 'en' ? 'Done' : '完成' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.setting-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-subtle);
}

.section-heading {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.setting-label {
  font-size: 12.5px;
  font-weight: 500;
}

.font-size-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.smart-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.check-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.openai-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mini-label {
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
