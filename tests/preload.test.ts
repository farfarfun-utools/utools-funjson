import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PRELOAD_PATH = path.resolve(__dirname, '../utools/preload.js')
const PRELOAD_CODE = fs.readFileSync(PRELOAD_PATH, 'utf8')

interface PreloadHarness {
  window: { funjson: NonNullable<Window['funjson']> }
  triggerEnter: (action: unknown) => void
  utoolsMock: {
    onPluginEnter: ReturnType<typeof vi.fn>
    showOpenDialog: ReturnType<typeof vi.fn>
    showSaveDialog: ReturnType<typeof vi.fn>
    getPath: ReturnType<typeof vi.fn>
  }
}

function loadPreload(): PreloadHarness {
  let enterCb: ((action: unknown) => void) | null = null
  const utoolsMock = {
    onPluginEnter: vi.fn((cb: (action: unknown) => void) => {
      enterCb = cb
    }),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    getPath: vi.fn(() => os.tmpdir()),
  }

  const sandboxWindow: Record<string, unknown> = {}
  const context = vm.createContext({
    require: createRequire(PRELOAD_PATH),
    window: sandboxWindow,
    utools: utoolsMock,
    Buffer,
    console,
  })
  vm.runInContext(PRELOAD_CODE, context, { filename: PRELOAD_PATH })

  return {
    window: sandboxWindow as unknown as { funjson: NonNullable<Window['funjson']> },
    triggerEnter: (action: unknown) => {
      if (enterCb) enterCb(action)
    },
    utoolsMock,
  }
}

describe('utools/preload.js', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funjson-preload-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('buffers early onPluginEnter action until onEnter listener subscribes', () => {
    const { window: win, triggerEnter } = loadPreload()
    const payload = { code: 'json-regex', type: 'regex', payload: '{"a":1}' }
    triggerEnter(payload)

    const received: unknown[] = []
    const unsubscribe = win.funjson.onEnter((action) => received.push(action))
    expect(received).toEqual([payload])

    const second = { code: 'funjson', type: 'text', payload: 'json' }
    triggerEnter(second)
    expect(received).toEqual([payload, second])

    unsubscribe()
    triggerEnter({ code: 'ignored', type: 'text', payload: '' })
    expect(received).toHaveLength(2)
  })

  it('opens valid files and rejects symlinks, directories, relative paths, and >16MB files', () => {
    const { window: win, utoolsMock } = loadPreload()
    const goodFile = path.join(tmpDir, 'sample.json')
    fs.writeFileSync(goodFile, '{"ok":true}', 'utf8')

    utoolsMock.showOpenDialog.mockReturnValue([goodFile])
    expect(win.funjson.openFile()).toEqual({ name: 'sample.json', content: '{"ok":true}' })

    // Symlink must be rejected
    const symFile = path.join(tmpDir, 'link.json')
    fs.symlinkSync(goodFile, symFile)
    utoolsMock.showOpenDialog.mockReturnValue([symFile])
    expect(() => win.funjson.openFile()).toThrow('仅支持读取普通本地文件')

    // Directory must be rejected
    utoolsMock.showOpenDialog.mockReturnValue([tmpDir])
    expect(() => win.funjson.openFile()).toThrow('仅支持读取普通本地文件')

    // Relative path must be rejected
    utoolsMock.showOpenDialog.mockReturnValue(['relative/file.json'])
    expect(() => win.funjson.openFile()).toThrow('文件路径无效')

    // Oversized (>16MB) file must be rejected
    const hugeFile = path.join(tmpDir, 'huge.json')
    fs.writeFileSync(hugeFile, Buffer.alloc(16 * 1024 * 1024 + 16, 0x61))
    utoolsMock.showOpenDialog.mockReturnValue([hugeFile])
    expect(() => win.funjson.openFile()).toThrow('16 MB')

    // readEntryFiles skips unreadable / symlink / oversized entries safely
    const entries = win.funjson.readEntryFiles([
      { path: goodFile },
      { path: symFile },
      { path: hugeFile },
      'relative.json',
    ])
    expect(entries).toEqual([{ name: 'sample.json', content: '{"ok":true}' }])
  })

  it('saves files safely and rejects >16MB export payloads', () => {
    const { window: win, utoolsMock } = loadPreload()
    const targetFile = path.join(tmpDir, 'exported.json')
    utoolsMock.showSaveDialog.mockReturnValue(targetFile)

    const saved = win.funjson.saveFile('bad:/name*.json', '{"saved":1}')
    expect(saved).toBe(true)
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('{"saved":1}')
    const saveArg = utoolsMock.showSaveDialog.mock.calls[0][0] as { defaultPath: string }
    expect(path.basename(saveArg.defaultPath)).toBe('bad__name_.json')

    const tooBig = 'a'.repeat(16 * 1024 * 1024 + 1)
    expect(() => win.funjson.saveFile('big.json', tooBig)).toThrow('16 MB')
  })
})
