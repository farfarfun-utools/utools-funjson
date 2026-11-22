import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { launch } from './cdp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'docs/screenshots')
const plugin = JSON.parse(fs.readFileSync(path.join(root, 'utools/plugin.json'), 'utf8'))
fs.mkdirSync(out, { recursive: true })

const server = await preview({
  root,
  build: { outDir: 'utools/dist' },
  preview: { host: '127.0.0.1', port: 0, open: false },
})

let browser
try {
  browser = await launch({ url: server.resolvedUrls.local[0] })
  const { session } = browser
  const errors = []
  const externalRequests = []

  session.on('Runtime.exceptionThrown', (event) => {
    errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text)
  })
  session.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') {
      errors.push(args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })
  session.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') errors.push(entry.text)
  })
  session.on('Network.requestWillBeSent', ({ request }) => {
    if (/^https?:/.test(request.url) && new URL(request.url).hostname !== '127.0.0.1') {
      externalRequests.push(request.url)
    }
  })

  await session.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })

  async function setViewport(width, height = plugin.pluginSetting.height) {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    })
  }

  async function raf(times = 2) {
    for (let i = 0; i < times; i += 1) {
      await session.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
    }
  }

  async function click(selector) {
    const ok = await session.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`)
    assert.equal(ok, true, `找不到元素: ${selector}`)
    await raf(2)
  }

  async function capture(name) {
    await session.evaluate('document.fonts.ready')
    await raf(2)
    const overflow = await session.evaluate('document.documentElement.scrollWidth > window.innerWidth')
    assert.equal(overflow, false, `${name}: 出现横向溢出`)
    const { cssContentSize } = await session.send('Page.getLayoutMetrics')
    assert.ok(
      cssContentSize.height <= plugin.pluginSetting.height,
      `${name}: 页面高度超出 ${plugin.pluginSetting.height}px，实际 ${cssContentSize.height}px`,
    )
    const result = await session.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(result.data, 'base64'))
    process.stdout.write(`${name}.png (${cssContentSize.width} × ${cssContentSize.height})\n`)
  }

  await setViewport(800)
  await browser.navigate()
  await session.waitForExpression('document.querySelector("[data-testid=code-editor-host] .cm-editor") !== null')
  await session.evaluate('document.fonts.ready')
  await raf(3)

  // 1. Light mode Code view with Smart Inspector (line 4 timestamp) + JSONPath bar open
  const line4Pos = await session.evaluate(`(() => {
    const lines = document.querySelectorAll('.cm-line');
    if (!lines[3]) return null;
    const rect = lines[3].getBoundingClientRect();
    return { x: rect.left + 165, y: rect.top + rect.height / 2 };
  })()`)
  if (line4Pos) {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: line4Pos.x, y: line4Pos.y, button: 'left', clickCount: 1 })
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: line4Pos.x, y: line4Pos.y, button: 'left', clickCount: 1 })
    await session.waitForExpression('document.querySelector("[data-testid=smart-inspector]") !== null')
  }
  await click('[data-testid="toggle-jsonpath-btn"]')
  await session.waitForExpression('document.querySelector("[data-testid=jsonpath-drawer]") !== null')
  await capture('home')

  // 2. Tree view
  await click('[data-testid="view-tree"]')
  await session.waitForExpression('document.querySelector("[data-testid=tree-view]") !== null')
  await capture('tree')

  // 3. Table view (with 3-level nested sub-table expanded and scrolled cleanly into view)
  await click('[data-testid="view-table"]')
  await session.waitForExpression('document.querySelector("[data-testid=table-view] table") !== null')
  await click('[data-table-path="root.users[0].profile"]')
  await session.waitForExpression(
    'document.querySelector("[data-testid=table-selected-path]")?.textContent?.includes("profile")',
  )
  await session.evaluate(`(() => {
    const el = document.querySelector('[data-table-path="root.users[0].profile"]');
    const nestedWrap = el?.closest('.nested-table-wrap.is-nested');
    if (nestedWrap) nestedWrap.scrollLeft = 225;
  })()`)
  await raf(2)
  await capture('table')

  // 4. Toolbox view (TypeScript type generator)
  await click('[data-testid="ws-toolbox-btn"]')
  await session.waitForExpression('document.querySelector("[data-testid=toolbox-view]") !== null')
  await click('[data-testid="tool-btn-types"]')
  await session.waitForExpression('document.querySelector("[data-testid=tool-panel-types]") !== null')
  await capture('toolbox')

  // 5. Dark mode Code view with JSONPath bar open
  await click('[data-testid="ws-workbench-btn"]')
  await click('[data-testid="view-code"]')
  await session.waitForExpression('document.querySelector("[data-testid=jsonpath-drawer]") !== null')
  // Cycle theme: system -> light -> dark
  await click('[data-testid="theme-btn"]')
  await click('[data-testid="theme-btn"]')
  await session.waitForExpression('document.documentElement.dataset.theme === "dark"')
  await capture('dark')

  // Verify narrow mobile viewport (375px) has zero horizontal overflow
  await setViewport(375, 720)
  await raf(2)
  const mobileOverflow = await session.evaluate('document.documentElement.scrollWidth > window.innerWidth')
  assert.equal(mobileOverflow, false, '375px 窄屏出现横向溢出')

  assert.deepEqual(errors, [], '浏览器运行报错')
  assert.deepEqual(externalRequests, [], '不应请求任何外部网络资源')
  process.stdout.write('FunJSON 浏览器检查与 5 张截图全部通过。\n')
} catch (err) {
  if (browser) {
    try {
      const html = await browser.session.evaluate('document.body.innerHTML.slice(0, 400)')
      console.error('[screenshots] body snippet:', html)
    } catch {
      // ignore
    }
  }
  throw err
} finally {
  await browser?.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
