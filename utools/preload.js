const fs = require('node:fs')
const path = require('node:path')

const MAX_FILE_BYTES = 16 * 1024 * 1024

let pendingEnter = null
let enterListener = null

if (typeof utools !== 'undefined' && typeof utools.onPluginEnter === 'function') {
  utools.onPluginEnter((action) => {
    if (enterListener) {
      enterListener(action)
    } else {
      pendingEnter = action
    }
  })
}

function readSafeFile(filePath) {
  if (typeof filePath !== 'string' || !filePath || !path.isAbsolute(filePath)) {
    throw new Error('文件路径无效')
  }
  const normalized = path.resolve(filePath)
  let stat
  try {
    stat = fs.lstatSync(normalized)
  } catch {
    throw new Error('无法读取指定文件')
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('仅支持读取普通本地文件')
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error('文件超过 16 MB 上限')
  }
  try {
    return {
      name: path.basename(normalized),
      content: fs.readFileSync(normalized, 'utf8'),
    }
  } catch {
    throw new Error('读取文件内容失败')
  }
}

window.funjson = {
  onEnter(callback) {
    if (typeof callback !== 'function') return () => {}
    enterListener = callback
    if (pendingEnter) {
      const queued = pendingEnter
      pendingEnter = null
      callback(queued)
    }
    return () => {
      if (enterListener === callback) enterListener = null
    }
  },
  openFile() {
    if (typeof utools === 'undefined' || typeof utools.showOpenDialog !== 'function') {
      return null
    }
    const picked = utools.showOpenDialog({
      title: '打开 JSON 文件',
      properties: ['openFile'],
      filters: [
        {
          name: 'JSON 与文本文件',
          extensions: ['json', 'json5', 'jsonc', 'ndjson', 'jsonl', 'txt'],
        },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (!Array.isArray(picked) || !picked.length) return null
    return readSafeFile(picked[0])
  },
  readEntryFiles(files) {
    if (!Array.isArray(files)) return []
    const out = []
    for (const item of files.slice(0, 10)) {
      const filePath = typeof item === 'string' ? item : item?.path
      if (!filePath) continue
      try {
        out.push(readSafeFile(filePath))
      } catch {
        // skip unreadable entry files safely
      }
    }
    return out
  },
  saveFile(defaultName, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('导出内容无效或超过 16 MB 上限')
    }
    if (typeof utools === 'undefined' || typeof utools.showSaveDialog !== 'function') {
      return false
    }
    // eslint-disable-next-line no-control-regex
    const safeName = String(defaultName || 'data.json').replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    const downloads = typeof utools.getPath === 'function' ? utools.getPath('downloads') : ''
    const target = utools.showSaveDialog({
      title: '导出文件',
      defaultPath: downloads ? path.join(downloads, safeName) : safeName,
    })
    if (!target) return false
    try {
      fs.writeFileSync(target, content, 'utf8')
      return true
    } catch {
      throw new Error('保存文件失败')
    }
  },
}
