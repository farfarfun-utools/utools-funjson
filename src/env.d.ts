/// <reference types="vite/client" />

export interface UtoolsPluginEnterAction {
  code: string
  type: string
  payload: unknown
  option?: unknown
}

export interface FunJsonFilePayload {
  name: string
  content: string
}

export interface FunJsonBridge {
  onEnter(callback: (action: UtoolsPluginEnterAction) => void): () => void
  openFile(): FunJsonFilePayload | null
  readEntryFiles(files: Array<string | { path?: string }>): FunJsonFilePayload[]
  saveFile(defaultName: string, content: string): boolean
}

export interface UtoolsAiModel {
  id: string
  label: string
  description?: string
  icon?: string
  cost?: number
}

export interface UtoolsAiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface UtoolsAiOptions {
  model?: string
  messages: UtoolsAiMessage[]
}

export interface UtoolsAiChunk {
  content?: string
  reasoning_content?: string
}

export interface UtoolsAiResponse {
  content?: string
  reasoning_content?: string
}

export interface UtoolsApi {
  onPluginEnter?(callback: (action: UtoolsPluginEnterAction) => void): void
  copyText?(text: string): boolean | void
  isDarkColors?(): boolean
  registerTool?(
    name: string,
    handler: (params: Record<string, unknown>) => unknown | Promise<unknown>,
  ): void
  ai?(
    options: UtoolsAiOptions,
    streamCallback?: (chunk: UtoolsAiChunk) => void,
  ): Promise<UtoolsAiResponse | string>
  allAiModels?(): Promise<UtoolsAiModel[]>
  showNotification?(body: string, clickFeatureCode?: string): void
  shellOpenExternal?(url: string): void
}

declare global {
  interface Window {
    funjson?: FunJsonBridge
    utools?: UtoolsApi
  }

  const utools: UtoolsApi | undefined
}
