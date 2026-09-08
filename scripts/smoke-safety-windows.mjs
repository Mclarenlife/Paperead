import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const testDir = path.resolve(`.tmp/native-safety-${Date.now()}`)
await mkdir(testDir, { recursive: true })
const executable = path.join(testDir, 'paperead.exe')
await copyFile(
  path.resolve(
    process.env.PAPEREAD_TEST_EXECUTABLE ||
      'src-tauri/target/x86_64-pc-windows-msvc/release/paperead.exe',
  ),
  executable,
)
const checks = [],
  errors = []
let requests = 0
const server = createServer(async (req, res) => {
  for await (const _ of req) {
    /* Drain the synthetic request. */
  }
  requests++
  const timer = setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: '# Native safety result\n\nCompleted.' }, finish_reason: 'stop' },
        ],
      }),
    )
  }, 8000)
  res.on('close', () => clearTimeout(timer))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
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
const launch = () =>
  Number(
    powershell(
      `$p = Start-Process -FilePath ${quoted(executable)} -WindowStyle Hidden -PassThru; $p.Id`,
    ),
  )
let appPid, browser, page
async function start() {
  appPid = launch()
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
try {
  await start()
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await page.getByLabel('模型 ID').fill('native-safety')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect.poll(() => requests).toBe(1)
  const duplicatePid = launch()
  await expect
    .poll(() =>
      powershell(
        `if (Get-Process -Id ${duplicatePid} -ErrorAction SilentlyContinue) { 'running' } else { 'exited' }`,
      ),
    )
    .toBe('exited')
  await expect(page.locator('.job-card')).toContainText('处理中')
  await expect(page.locator('.job-card')).toContainText('已完成', { timeout: 15_000 })
  expect(requests).toBe(1)
  checks.push('duplicate Windows process exits; original task remains running and finishes once')
  console.log('PASS: native single instance and unchanged AI request')
  await page.getByLabel('返回文献库').click()
  await page.getByLabel('更多操作 Attention Is All You Need', { exact: true }).click()
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click()
  await expect(page.locator('.paper-card')).toHaveCount(5)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.trash-row')).toHaveCount(1)
  await page.screenshot({ path: '.tmp/windows-trash-014.png', animations: 'disabled' })
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '全部文献', exact: false }).first().click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: '智能翻译', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('Native safety result')
  await page.getByLabel('返回文献库').click()
  checks.push('native recycle and restore preserves completed AI result')
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('笔记标题')).toBeVisible()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'notes') throw new DOMException('Native test quota', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page
    .getByLabel('Markdown 笔记正文')
    .fill('# Windows persistent draft\n\nRetain this after an interrupted write.')
  await expect(page.getByRole('alert')).toContainText('笔记保存失败')
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  )
  await expect(page.getByRole('dialog', { name: '笔记尚未保存' })).toBeVisible()
  await page.screenshot({ path: '.tmp/windows-draft-guard-014.png', animations: 'disabled' })
  await page.getByRole('button', { name: '返回编辑', exact: true }).click()
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  )
  await page.getByRole('button', { name: '仍然关闭', exact: true }).click()
  await expect.poll(() => page.isClosed()).toBe(true)
  checks.push('native window close is intercepted when note write failed')
  await stop()
  await start()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/Retain this after/)
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.locator('.save-state')).toContainText('已保存到本地')
  await stop()
  await start()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/Retain this after/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  checks.push(
    'failed draft survives full Windows process restart; retry becomes canonical note after second restart',
  )
  await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }),
  )
  await expect.poll(() => page.isClosed()).toBe(true)
  checks.push('confirmed close and normal close both exit successfully')
  expect(errors).toEqual([])
  const report = { passed: true, checks, requests, errors }
  await writeFile('.tmp/windows-safety-015-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await stop()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
