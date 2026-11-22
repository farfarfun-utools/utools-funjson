<script setup lang="ts">
import { computed, ref } from 'vue'
import { repairJsonWithAi } from '../lib/ai-repair'
import { computeDiff } from '../lib/diff'
import { repairJsonLocal, type DataFormat, type IndentOption } from '../lib/formats'
import { t } from '../lib/i18n'
import { JSONPATH_EXAMPLES, runJsonPath } from '../lib/jsonpath'
import { convertJsonKeys, NAMING_STYLES, type NamingStyle } from '../lib/keynaming'
import { SAMPLES, type FunJsonSettings, type ToolId } from '../lib/storage'
import { generateTypes, TARGET_LANGUAGES, type TargetLanguage } from '../lib/typegen'
import AppIcon, { type IconName } from './AppIcon.vue'

const props = defineProps<{
  activeTool: ToolId
  currentContent: string
  currentFormat: DataFormat
  indent: IndentOption
  settings: FunJsonSettings
}>()

const emit = defineEmits<{
  'apply-to-tab': [payload: { content: string; format?: DataFormat }]
  'open-new-tab': [payload: { content: string; format: DataFormat; title?: string }]
  copy: [text: string]
  export: [payload: { filename: string; content: string }]
  notify: [payload: { message: string; kind?: 'info' | 'success' | 'error' }]
}>()

interface ToolMeta {
  id: ToolId
  icon: IconName
  key: string
  tone: 'cerulean' | 'violet' | 'blue' | 'amber'
  catZh: string
  catEn: string
}

const TOOL_LIST: ToolMeta[] = [
  {
    id: 'repair',
    icon: 'sparkles',
    key: 'tool.repair',
    tone: 'violet',
    catZh: '结构修复',
    catEn: 'Repair',
  },
  {
    id: 'types',
    icon: 'code',
    key: 'tool.types',
    tone: 'cerulean',
    catZh: '代码生成',
    catEn: 'Codegen',
  },
  {
    id: 'jsonpath',
    icon: 'filter',
    key: 'tool.jsonpath',
    tone: 'blue',
    catZh: '查询过滤',
    catEn: 'Query',
  },
  {
    id: 'naming',
    icon: 'case-sensitive',
    key: 'tool.naming',
    tone: 'amber',
    catZh: '命名规范',
    catEn: 'Naming',
  },
]

const activeToolMeta = computed(
  () => TOOL_LIST.find((item) => item.id === props.activeTool) ?? TOOL_LIST[0],
)

// 1. Repair state
const repairInput = ref(
  "{ name: 'FunJSON', version: 1, tags: ['offline', 'fast',], active: true }",
)
const repairOutput = ref('')
const repairSource = ref<'local' | 'utools-ai' | 'openai' | null>(null)
const repairError = ref('')
const repairBusy = ref(false)

const repairDiff = computed(() =>
  repairOutput.value ? computeDiff(repairInput.value, repairOutput.value) : null,
)

async function runRepair(useAi = false) {
  repairError.value = ''
  repairBusy.value = true
  try {
    if (!useAi || props.settings.ai.provider === 'local') {
      const res = repairJsonLocal(repairInput.value, props.indent)
      repairOutput.value = res.output
      repairSource.value = 'local'
    } else {
      const res = await repairJsonWithAi(repairInput.value, {
        ...props.settings.ai,
        indent: props.indent,
      })
      repairOutput.value = res.output
      repairSource.value = res.source
    }
  } catch (err) {
    repairError.value = err instanceof Error ? err.message : 'Repair failed'
  } finally {
    repairBusy.value = false
  }
}

// 2. Types state
const typesInput = ref(
  props.currentFormat === 'json' && props.currentContent ? props.currentContent : SAMPLES.json,
)
const typesLang = ref<TargetLanguage>('typescript')
const typesRootName = ref('UserPayload')

const typesResult = computed<{ output: string; error: string }>(() => {
  if (!typesInput.value.trim()) return { output: '', error: '' }
  try {
    return {
      output: generateTypes(typesInput.value, typesLang.value, typesRootName.value),
      error: '',
    }
  } catch (err) {
    return { output: '', error: err instanceof Error ? err.message : 'Type generation failed' }
  }
})

const activeLangMeta = computed(
  () => TARGET_LANGUAGES.find((item) => item.id === typesLang.value) ?? TARGET_LANGUAGES[0],
)

// 3. JSONPath state
const jpInput = ref(
  props.currentFormat === 'json' && props.currentContent ? props.currentContent : SAMPLES.json,
)
const jpExpr = ref('$.users[?@.score >= 90].name')
const jpResult = computed(() => runJsonPath(jpInput.value, jpExpr.value))

// 4. Key Naming state
const namingInput = ref(
  JSON.stringify(
    {
      user_id: 1001,
      first_name: 'Alice',
      created_at: 1732272000,
      keep_raw: true,
      nested_profile: { last_login_ip: '127.0.0.1' },
    },
    null,
    2,
  ),
)
const namingStyle = ref<NamingStyle>('camel')
const namingIgnore = ref('keep_raw')

const namingResult = computed<{ output: string; error: string }>(() => {
  if (!namingInput.value.trim()) return { output: '', error: '' }
  try {
    const ignoreList = namingIgnore.value
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      output: convertJsonKeys(namingInput.value, namingStyle.value, ignoreList, props.indent),
      error: '',
    }
  } catch (err) {
    return { output: '', error: err instanceof Error ? err.message : 'Key naming failed' }
  }
})

const namingDiff = computed(() =>
  namingResult.value.output ? computeDiff(namingInput.value, namingResult.value.output) : null,
)

function loadFromCurrentTab() {
  const content = props.currentContent
  switch (props.activeTool) {
    case 'repair':
      repairInput.value = content
      void runRepair(false)
      break
    case 'types':
      typesInput.value = content
      break
    case 'jsonpath':
      jpInput.value = content
      break
    case 'naming':
      namingInput.value = content
      break
  }
  emit('notify', {
    message: props.settings.locale === 'en' ? 'Loaded from active tab' : '已载入当前标签内容',
    kind: 'info',
  })
}

function loadSampleForTool() {
  switch (props.activeTool) {
    case 'repair':
      repairInput.value = SAMPLES.broken
      void runRepair(false)
      break
    case 'types':
      typesInput.value = SAMPLES.json
      break
    case 'jsonpath':
      jpInput.value = SAMPLES.json
      jpExpr.value = '$.users[?@.score >= 90].name'
      break
    case 'naming':
      namingInput.value = JSON.stringify(
        { user_id: 1001, first_name: 'Alice', nested_info: { created_at: 1732272000 } },
        null,
        2,
      )
      break
  }
}

void runRepair(false)
</script>

<template>
  <section class="tool-stage" data-testid="toolbox-view">
    <header class="tool-header">
      <div class="tool-title-group">
        <span class="rail-badge" :class="`tone-${activeToolMeta.tone}`">
          <AppIcon :name="activeToolMeta.icon" :size="14" />
        </span>
        <h2 class="tool-title">{{ t(settings.locale, `tool.${activeTool}`) }}</h2>
        <span class="badge badge-neutral">
          {{ settings.locale === 'en' ? activeToolMeta.catEn : activeToolMeta.catZh }}
        </span>
      </div>
      <div class="tool-header-actions">
        <button type="button" class="ghost-btn xs" @click="loadFromCurrentTab">
          <AppIcon name="upload" :size="12" />
          <span>{{ settings.locale === 'en' ? 'Load Tab' : '载入当前标签' }}</span>
        </button>
        <button type="button" class="ghost-btn xs" @click="loadSampleForTool">
          <AppIcon name="sparkles" :size="12" />
          <span>{{ t(settings.locale, 'action.sample') }}</span>
        </button>
      </div>
    </header>

    <!-- 1. JSON Repair -->
    <div v-if="activeTool === 'repair'" class="tool-body" data-testid="tool-panel-repair">
      <div class="tool-subbar">
        <button type="button" class="pill-btn primary xs" :disabled="repairBusy" @click="runRepair(false)">
          <AppIcon name="sparkles" :size="12" />
          <span>{{ settings.locale === 'en' ? 'Local Repair' : '本地修复' }}</span>
        </button>
        <button
          v-if="settings.ai.provider !== 'local'"
          type="button"
          class="pill-btn soft xs"
          :disabled="repairBusy"
          @click="runRepair(true)"
        >
          {{ repairBusy ? '...' : settings.locale === 'en' ? 'AI Repair' : 'AI 智能修复' }}
        </button>
        <span v-if="repairSource" class="badge badge-accent">{{ repairSource }}</span>
        <span v-if="repairDiff" class="badge badge-neutral tabular">
          +{{ repairDiff.stats.added }} / -{{ repairDiff.stats.removed }} / ~{{ repairDiff.stats.modified }}
        </span>
        <span v-if="repairError" class="badge badge-danger">{{ repairError }}</span>
        <div class="spacer" />
        <button type="button" class="ghost-btn xs" :disabled="!repairOutput" @click="emit('copy', repairOutput)">
          <AppIcon name="copy" :size="12" />
          <span>{{ t(settings.locale, 'action.copy') }}</span>
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          :disabled="!repairOutput"
          @click="emit('apply-to-tab', { content: repairOutput, format: 'json' })"
        >
          {{ t(settings.locale, 'action.apply') }}
        </button>
        <button
          type="button"
          class="pill-btn soft xs"
          :disabled="!repairOutput"
          @click="emit('open-new-tab', { content: repairOutput, format: 'json', title: 'Repaired JSON' })"
        >
          {{ settings.locale === 'en' ? 'New Tab' : '新建标签' }}
        </button>
      </div>
      <div class="split-2">
        <div class="pane-box">
          <div class="pane-title">{{ settings.locale === 'en' ? 'Broken JSON Input' : '待修复输入' }}</div>
          <textarea v-model="repairInput" class="code-textarea" spellcheck="false" />
        </div>
        <div class="pane-box">
          <div class="pane-title">{{ settings.locale === 'en' ? 'Repaired Output' : '修复结果' }}</div>
          <textarea :value="repairOutput" readonly class="code-textarea" spellcheck="false" data-testid="repair-output" />
        </div>
      </div>
    </div>

    <!-- 2. Type Generator -->
    <div v-else-if="activeTool === 'types'" class="tool-body" data-testid="tool-panel-types">
      <div class="tool-subbar wrap">
        <div class="chip-strip">
          <button
            v-for="lang in TARGET_LANGUAGES"
            :key="lang.id"
            type="button"
            class="chip-btn"
            :class="{ active: typesLang === lang.id }"
            @click="typesLang = lang.id"
          >
            {{ lang.label }}
          </button>
        </div>
        <input
          v-model="typesRootName"
          type="text"
          class="field-input mono root-name-input"
          :placeholder="settings.locale === 'en' ? 'Root Name' : '根类型名'"
          aria-label="Root type name"
        />
        <button type="button" class="ghost-btn xs" :disabled="!typesResult.output" @click="emit('copy', typesResult.output)">
          <AppIcon name="copy" :size="12" />
          <span>{{ t(settings.locale, 'action.copy') }}</span>
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          :disabled="!typesResult.output"
          @click="
            emit('export', {
              filename: `${typesRootName || 'Root'}.${activeLangMeta.ext}`,
              content: typesResult.output,
            })
          "
        >
          <AppIcon name="download" :size="12" />
          <span>{{ settings.locale === 'en' ? 'Export' : '导出' }}</span>
        </button>
        <button
          type="button"
          class="pill-btn soft xs"
          :disabled="!typesResult.output"
          @click="
            emit('open-new-tab', {
              content: typesResult.output,
              format: typesLang === 'jsonschema' ? 'json' : 'text',
              title: `${typesRootName || 'Root'}.${activeLangMeta.ext}`,
            })
          "
        >
          {{ settings.locale === 'en' ? 'New Tab' : '新标签' }}
        </button>
      </div>
      <div v-if="typesResult.error" class="inline-err">{{ typesResult.error }}</div>
      <div class="split-2">
        <div class="pane-box">
          <div class="pane-title">JSON / JSON5</div>
          <textarea v-model="typesInput" class="code-textarea" spellcheck="false" />
        </div>
        <div class="pane-box">
          <div class="pane-title">{{ activeLangMeta.label }}</div>
          <textarea
            :value="typesResult.output"
            readonly
            class="code-textarea"
            spellcheck="false"
            data-testid="types-output"
          />
        </div>
      </div>
    </div>

    <!-- 3. JSONPath Playground -->
    <div v-else-if="activeTool === 'jsonpath'" class="tool-body" data-testid="tool-panel-jsonpath">
      <div class="tool-subbar wrap">
        <input
          v-model="jpExpr"
          type="text"
          class="field-input mono grow-input"
          placeholder="$.users[*].name"
          aria-label="JSONPath playground expression"
        />
        <span v-if="!jpResult.error" class="badge badge-success">
          {{ t(settings.locale, 'status.matches', { count: jpResult.count }) }}
        </span>
        <span v-else class="badge badge-danger">{{ jpResult.error }}</span>
        <button type="button" class="ghost-btn xs" :disabled="Boolean(jpResult.error)" @click="emit('copy', jpResult.formatted)">
          <AppIcon name="copy" :size="12" />
          <span>{{ t(settings.locale, 'action.copy') }}</span>
        </button>
        <button
          type="button"
          class="pill-btn soft xs"
          :disabled="Boolean(jpResult.error)"
          @click="emit('open-new-tab', { content: jpResult.formatted, format: 'json', title: 'JSONPath Result' })"
        >
          {{ settings.locale === 'en' ? 'New Tab' : '新建标签' }}
        </button>
      </div>
      <div class="chip-bar">
        <button
          v-for="ex in JSONPATH_EXAMPLES"
          :key="ex.id"
          type="button"
          class="chip-btn"
          :class="{ active: jpExpr === ex.expression }"
          @click="jpExpr = ex.expression"
        >
          {{ settings.locale === 'en' ? ex.titleEn : ex.titleZh }}
        </button>
      </div>
      <div class="split-2">
        <div class="pane-box">
          <div class="pane-title">JSON</div>
          <textarea v-model="jpInput" class="code-textarea" spellcheck="false" />
        </div>
        <div class="pane-box">
          <div class="pane-title">
            {{ settings.locale === 'en' ? 'Matches & Paths' : '匹配结果与路径' }}
          </div>
          <textarea
            :value="jpResult.formatted"
            readonly
            class="code-textarea"
            spellcheck="false"
            data-testid="jsonpath-tool-output"
          />
          <div v-if="jpResult.paths.length > 0" class="paths-strip mono">
            <span v-for="p in jpResult.paths.slice(0, 12)" :key="p" class="badge badge-neutral">{{ p }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. Key Naming Converter -->
    <div v-else-if="activeTool === 'naming'" class="tool-body" data-testid="tool-panel-naming">
      <div class="tool-subbar wrap">
        <div class="chip-strip">
          <button
            v-for="style in NAMING_STYLES"
            :key="style.id"
            type="button"
            class="chip-btn mono"
            :class="{ active: namingStyle === style.id }"
            :title="style.example"
            @click="namingStyle = style.id"
          >
            {{ style.label }}
          </button>
        </div>
        <input
          v-model="namingIgnore"
          type="text"
          class="field-input mono root-name-input"
          :placeholder="settings.locale === 'en' ? 'Ignore keys (comma)' : '忽略键（逗号分隔）'"
        />
        <span v-if="namingDiff" class="badge badge-neutral tabular">
          ~{{ namingDiff.stats.modified }}
        </span>
        <button type="button" class="ghost-btn xs" :disabled="!namingResult.output" @click="emit('copy', namingResult.output)">
          <AppIcon name="copy" :size="12" />
          <span>{{ t(settings.locale, 'action.copy') }}</span>
        </button>
        <button
          type="button"
          class="ghost-btn xs"
          :disabled="!namingResult.output"
          @click="emit('apply-to-tab', { content: namingResult.output, format: 'json' })"
        >
          {{ t(settings.locale, 'action.apply') }}
        </button>
        <button
          type="button"
          class="pill-btn soft xs"
          :disabled="!namingResult.output"
          @click="emit('open-new-tab', { content: namingResult.output, format: 'json', title: `Keys (${namingStyle})` })"
        >
          {{ settings.locale === 'en' ? 'New Tab' : '新建标签' }}
        </button>
      </div>
      <div v-if="namingResult.error" class="inline-err">{{ namingResult.error }}</div>
      <div class="split-2">
        <div class="pane-box">
          <div class="pane-title">{{ settings.locale === 'en' ? 'Input JSON' : '原始 JSON' }}</div>
          <textarea v-model="namingInput" class="code-textarea" spellcheck="false" />
        </div>
        <div class="pane-box">
          <div class="pane-title">{{ namingStyle }}</div>
          <textarea
            :value="namingResult.output"
            readonly
            class="code-textarea"
            spellcheck="false"
            data-testid="naming-output"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rail-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  flex-shrink: 0;
}

.tone-cerulean {
  background: var(--accent-soft);
  color: var(--accent);
}
.tone-violet {
  background: rgba(124, 58, 237, 0.12);
  color: var(--type-arr);
}
.tone-blue {
  background: rgba(37, 99, 235, 0.12);
  color: var(--type-num);
}
.tone-amber {
  background: var(--warning-soft);
  color: var(--warning);
}

.tool-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-canvas);
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
  flex-shrink: 0;
}

.tool-title-group {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.tool-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
}

.tool-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.tool-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tool-subbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.tool-subbar.wrap {
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.chip-strip,
.chip-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.chip-bar {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-canvas);
}

.root-name-input {
  width: 140px;
  height: 24px;
}

.grow-input {
  flex: 1;
  min-width: 140px;
  height: 26px;
}

.inline-err {
  padding: 5px 12px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}

.split-2 {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}

.pane-box {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.split-2 > .pane-box:first-child {
  border-right: 1px solid var(--border);
}

.pane-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border);
}

.paths-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
  max-height: 62px;
  overflow-y: auto;
}

@media (max-width: 640px) {
  .split-2 {
    grid-template-columns: 1fr;
  }
}
</style>
