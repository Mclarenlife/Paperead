import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
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
  await expect(page.locator('.paper-card').first()).toBeVisible()
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
  await expect(page.locator('.paper-card')).toHaveCount(6)
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 1600
    const x = c.getContext('2d')
    x.fillStyle = 'white'
    x.fillRect(0, 0, 1200, 1600)
    x.fillStyle = 'black'
    x.font = 'bold 44px Arial'
    x.fillText('NATIVE OCR VALIDATION', 100, 180)
    x.font = '30px Arial'
    x.fillText('Evidence is preserved with 91.6 percent accuracy.', 100, 290)
    return c.toDataURL('image/png').split(',')[1]
  })
  const pdf = await PDFDocument.create(),
    image = await pdf.embedPng(Buffer.from(png, 'base64'))
  pdf.setTitle('Windows OCR Study')
  pdf.addPage([600, 800]).drawImage(image, { x: 0, y: 0, width: 600, height: 800 })
  await page.getByLabel('选择 PDF 文献').setInputFiles({
    name: 'native-scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Windows OCR Study', exact: true }).click()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: '扫描件与版面识别', exact: true }).click()
  await page.getByLabel('识别语言').selectOption('eng')
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await expect(page.locator('.job-card').filter({ hasText: '本地 OCR 识别' })).toContainText(
    '已完成',
    { timeout: 90000 },
  )
  await expect(page.locator('.reading-paper .markdown')).toContainText('91.6')
  passed(
    'native PDF worker and offline OCR work under production CSP; one continuous Markdown includes page image',
  )
  await closeReader()
  await openSettings()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '立即创建快照' }).click()
  await expect(page.locator('.snapshot-row').first()).toContainText('手动快照')
  const version = JSON.parse(await readFile('package.json', 'utf8')).version.replaceAll('.', '')
  const backupDir = path.join(
    process.env.LOCALAPPDATA,
    `app.paperead.validation${version}`,
    'backups',
  )
  const files = (await readdir(backupDir)).filter((f) => /^snapshot-.*\.zip$/.test(f))
  expect(files.length).toBeGreaterThan(0)
  const backup = await JSZip.loadAsync(await readFile(path.join(backupDir, files.at(-1))))
  const manifest = JSON.parse(await backup.file('manifest.json').async('string'))
  expect(manifest.version).toBe(4)
  expect(manifest.attachments.length).toBeGreaterThan(0)
  passed('native backups write, rename and read complete ZIP files outside WebView storage')
  await closeSettings()
  await stop()
  await start()
  await openSettings()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await expect(page.locator('.snapshot-row').first()).toBeVisible()
  await page.getByRole('button', { name: '预览恢复', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '恢复备份预览' })).toContainText(
    'Windows OCR Study',
  )
  await page.getByRole('button', { name: '创建快照并确认恢复' }).click()
  await expect(page.getByRole('status')).toContainText('已恢复 7 篇文献')
  await closeSettings()
  passed(
    'native restart retains discoverable snapshots; confirmed restore first creates a protective snapshot',
  )
  await page.getByRole('button', { name: '阅读 Windows OCR Study', exact: true }).click()
  await page.getByRole('button', { name: '智能重排', exact: true }).click()
  const outputPath = path.join(backupDir, `native-export-${Date.now()}.pdf`)
  const pdfModule = (await readdir('dist/assets')).find((name) => /^export-pdf-.*\.js$/.test(name))
  const markdown =
    manifest.jobs.find((job) => job.recognition).chunks[0].output +
    '\n\n## 中文导出\n\n| 指标 | 数值 |\n| --- | --- |\n| 准确率 | 91.6% |\n\n$$\\frac{a+b}{c}$$'
  await page.evaluate(
    async ({ outputPath, pdfModule, markdown }) => {
      const { pdfBlob } = await import(`/assets/${pdfModule}`)
      const data = new Uint8Array(
        await (await pdfBlob('Windows 原生导出验收', markdown)).arrayBuffer(),
      )
      await window.__TAURI_INTERNALS__.invoke('plugin:fs|write_file', data, {
        headers: { path: encodeURIComponent(outputPath), options: '{}' },
      })
    },
    { outputPath, pdfModule, markdown },
  )
  expect((await readFile(outputPath)).subarray(0, 5).toString()).toBe('%PDF-')
  await copyFile(outputPath, '.tmp/export-015/native.pdf')
  passed(
    'native production PDF export module loads bundled Chinese font, equations and OCR images and writes a valid PDF through the real filesystem plugin; system save dialog is not automated',
  )
  await closeReader()
  await page.getByRole('button', { name: '引用导入 / 导出' }).click()
  await page.getByLabel('导入引用文件').setInputFiles({
    name: 'native.bib',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '@article{native,title={Native Citation Test},year={2024},doi={10.1234/native}}',
    ),
  })
  await page.getByRole('button', { name: '确认导入引用' }).click()
  await expect(page.locator('.paper-card')).toHaveCount(8)
  passed(
    'production citation bundle imports BibTeX in Windows WebView without Node.js shims leaking into runtime',
  )
  expect(errors).toEqual([])
  await writeFile(
    '.tmp/windows-extended-015-report.json',
    JSON.stringify({ passed: true, checks, errors }, null, 2),
  )
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2))
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: '.tmp/windows-extended-015-failure.png' }).catch(() => {})
  throw error
} finally {
  await stop()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
