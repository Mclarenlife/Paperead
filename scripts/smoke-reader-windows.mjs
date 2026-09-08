import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const testDir = path.resolve(`.tmp/native-reader-${Date.now()}`)
await mkdir(testDir, { recursive: true })
const executable = path.join(testDir, 'paperead.exe')
await copyFile(
  path.resolve(
    process.env.PAPEREAD_TEST_EXECUTABLE ||
      'src-tauri/target/x86_64-pc-windows-msvc/release/paperead.exe',
  ),
  executable,
)
const requests = [],
  errors = [],
  checks = []
const body =
  '# Native translation\n\n' +
  Array.from(
    { length: 25 },
    (_, i) =>
      `## Section ${i + 1}\n\nResearch paragraph ${i + 1} with sufficient detail to validate reading position restoration and immutable document versions.\n\n`,
  ).join('')
const corrected = '# Native correction\n\nOnlyEditedInput must be reformatted.\n\n' + body
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const bytes of req) raw += bytes
  const payload = JSON.parse(raw)
  requests.push({ path: req.url, payload, auth: req.headers.authorization })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content:
              payload.model === 'native-reflow'
                ? '# Native reflow\n\nOnlyEditedInput was used.'
                : body,
          },
        },
      ],
    }),
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const cdpPort = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const quoted = (value) => `'${value.replaceAll("'", "''")}'`
const powershell = (code) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', code], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1`,
      WEBVIEW2_USER_DATA_FOLDER: path.join(testDir, 'profile'),
    },
  }).trim()
let appPid, browser, page
async function start() {
  appPid = Number(
    powershell(
      `$p = Start-Process -FilePath ${quoted(executable)} -WindowStyle Hidden -PassThru; $p.Id`,
    ),
  )
  const endpoint = `http://127.0.0.1:${cdpPort}`
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${endpoint}/json/version`)).ok
        } catch {
          return false
        }
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  browser = await chromium.connectOverCDP(endpoint)
  page = browser.contexts()[0].pages()[0]
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('.paper-card')).toHaveCount(6)
}
async function stop() {
  if (browser) {
    await browser.close().catch(() => {})
    browser = undefined
  }
  if (appPid) {
    powershell(
      `$p = Get-Process -Id ${appPid} -ErrorAction SilentlyContinue; if ($p -and $p.Path -eq ${quoted(executable)}) { Stop-Process -Id ${appPid} -Force -ErrorAction Stop }; exit 0`,
    )
    appPid = undefined
  }
}
const openSettings = () => page.getByRole('button', { name: '偏好设置', exact: false }).click()
const closeSettings = () => page.getByRole('button', { name: '关闭', exact: true }).click()
const openReader = () =>
  page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
const closeReader = () => page.getByLabel('返回文献库').click()
const requestClose = () =>
  page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }))
function passed(message) {
  checks.push(message)
  console.log(`PASS: ${message}`)
}
try {
  await start()
  await openSettings()
  await page.getByLabel('配置名称', { exact: true }).fill('原生翻译配置')
  await page.getByLabel('API 地址').fill(`${base}/a/v1`)
  await page.getByLabel('模型 ID').fill('native-source')
  await page.locator('input[type="password"]').fill('native-reader-key-a')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await page.getByRole('button', { name: '新建配置', exact: true }).click()
  await page.getByLabel('配置名称', { exact: true }).fill('原生重排配置')
  await page.getByLabel('API 地址').fill(`${base}/b/v1`)
  await page.getByLabel('模型 ID').fill('native-reflow')
  await page.locator('input[type="password"]').fill('native-reader-key-b')
  await page.getByText('请求与性能设置', { exact: true }).click()
  await page.getByLabel('单批次超时（秒）').fill('600')
  await page.getByLabel('并行请求数').selectOption('1')
  await page.getByLabel('输出 Token 上限').fill('12288')
  await page.getByLabel('流式输出').uncheck()
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await page.getByLabel('服务配置档案').selectOption({ label: '原生翻译配置' })
  await expect(page.getByLabel('模型 ID')).toHaveValue('native-source')
  await closeSettings()
  await stop()
  await start()
  await openReader()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('已完成')
  expect(requests).toHaveLength(1)
  expect(requests[0].auth).toBe('Bearer native-reader-key-a')
  expect(requests[0].path).toBe('/a/v1/chat/completions')
  passed('saved profile and Windows credential A survive full application restart')
  await page.getByRole('button', { name: '校对当前结果', exact: true }).click()
  await page.getByLabel('修订版本名称', { exact: true }).fill('原生校对定稿')
  await page.getByLabel('校对 Markdown 正文').fill(corrected)
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'jobs')
        throw new DOMException('Native correction quota fixture', 'QuotaExceededError')
      return add.apply(this, args)
    }
  })
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('草稿已保留')
  await requestClose()
  await expect(page.getByRole('dialog', { name: '校对草稿尚未保存', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回校对', exact: true }).click()
  await expect(page.getByLabel('校对 Markdown 正文')).toHaveValue(corrected)
  await requestClose()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await expect.poll(() => page.isClosed()).toBe(true)
  passed('failed correction write preserves draft and native close requires an explicit choice')
  await stop()
  await start()
  await openReader()
  await page.getByRole('button', { name: '智能翻译', exact: true }).click()
  await page.getByRole('button', { name: '校对当前结果', exact: true }).click()
  await expect(page.getByLabel('校对 Markdown 正文')).toHaveValue(corrected)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('OnlyEditedInput')
  passed('correction draft recovers after process restart and saves as an independent version')
  await page.locator('.reader-scroll').evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.65
    el.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await page.getByLabel('全文查找与目录').click()
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await page.getByLabel('书签名称').fill('原生校对阅读位置')
  await page.getByRole('button', { name: '添加当前位置书签', exact: true }).click()
  await expect(page.locator('.bookmark-row')).toContainText('原生校对阅读位置')
  await closeReader()
  await expect(page.locator('.reader-overlay')).toHaveCount(0)
  await stop()
  await start()
  await openReader()
  await expect(page.locator('.reading-paper')).toContainText('OnlyEditedInput')
  await expect
    .poll(() =>
      page
        .locator('.reader-scroll')
        .evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)),
    )
    .toBeGreaterThan(0.55)
  await page.getByLabel('全文查找与目录').click()
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await expect(page.locator('.bookmark-row')).toContainText('原生校对阅读位置')
  await page.screenshot({ path: '.tmp/windows-reader-bookmarks-014.png', animations: 'disabled' })
  passed('revision, reading position and version-specific bookmark survive full restart')
  await closeReader()
  await openSettings()
  await page.getByLabel('服务配置档案').selectOption({ label: '原生重排配置' })
  await expect(page.getByLabel('模型 ID')).toHaveValue('native-reflow')
  await page.getByText('请求与性能设置', { exact: true }).click()
  await expect(page.getByLabel('单批次超时（秒）')).toHaveValue('600')
  await expect(page.getByLabel('并行请求数')).toHaveValue('1')
  await closeSettings()
  await openReader()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByLabel('重排输入来源').selectOption({ label: '原生校对定稿' })
  await page.getByRole('button', { name: /开始重排/ }).click()
  await expect(page.locator('.reading-paper')).toContainText('Native reflow')
  await expect(page.locator('.job-card').first()).toContainText('已完成')
  expect(requests).toHaveLength(2)
  const request = requests[1]
  expect(request.auth).toBe('Bearer native-reader-key-b')
  expect(request.path).toBe('/b/v1/chat/completions')
  expect(request.payload.model).toBe('native-reflow')
  expect(request.payload.stream).toBe(false)
  expect(request.payload.max_tokens).toBe(12288)
  const input = JSON.parse(
    request.payload.messages
      .at(-1)
      .content.split('SOURCE_JSON:\n')[1]
      .split('\nEND_SOURCE_JSON')[0],
  )
  expect(input.text).toContain('OnlyEditedInput')
  expect(input.text).not.toContain('Vaswani')
  passed(
    'profile B restores its credential and sends selected correction with its own model and parameters',
  )
  await page
    .locator('.job-card')
    .filter({ has: page.locator('.result-version-name', { hasText: '原生校对定稿' }) })
    .getByRole('button', { name: '删除版本', exact: true })
    .click()
  await page.getByRole('button', { name: '确认删除版本', exact: true }).click()
  await expect(page.locator('.job-card')).toHaveCount(2)
  await expect(page.locator('.reading-paper')).toContainText('Native reflow')
  await page.getByLabel('全文查找与目录').click()
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await expect(page.locator('.bookmark-row')).toHaveCount(0)
  passed(
    'deleting source revision cleans its bookmark and preserves original translation and derived reflow',
  )
  expect(errors).toEqual([])
  await writeFile(
    '.tmp/windows-reader-015-report.json',
    JSON.stringify({ passed: true, checks, nativeRequests: requests.length, errors }, null, 2),
  )
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: '.tmp/windows-reader-015-failure.png' }).catch(() => {})
  throw error
} finally {
  // Only remove this run's synthetic credentials at its random local port.
  if (page && !page.isClosed())
    for (const endpoint of [`${base}/a/v1`, `${base}/b/v1`]) {
      const account = createHash('sha256').update(`compatible:${endpoint}`).digest('hex')
      await page
        .evaluate(
          (account) => window.__TAURI_INTERNALS__.invoke('delete_credential', { account }),
          account,
        )
        .catch(() => {})
    }
  await stop()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
