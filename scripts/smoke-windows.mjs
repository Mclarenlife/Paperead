import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'

// Connect only to a test app started with an isolated WebView2 profile.
// No debug port or test endpoint is enabled by the shipped application.
const endpoint = process.env.PAPEREAD_CDP_URL || 'http://127.0.0.1:9240'
await mkdir('.tmp', { recursive: true })
const pdf = await PDFDocument.create()
pdf.setTitle('Windows Native Smoke Study')
const font = await pdf.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= 2; i++) {
  const page = pdf.addPage([595, 842])
  page.drawText(`Windows Native Smoke Study - Page ${i}`, { x: 60, y: 750, size: 20, font })
  page.drawText('Researchers verify local PDF rendering and persistent annotations.', {
    x: 60,
    y: 700,
    size: 11,
    font,
  })
}
await writeFile('.tmp/native-smoke.pdf', await pdf.save())
const requests = []
const server = createServer(async (req, res) => {
  try {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, method: req.method, body: JSON.parse(body) })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: '# 原生接口测试\n\nWindows 原生 HTTP 已收到测试响应。',
            },
          },
        ],
      }),
    )
  } catch {
    res.writeHead(400).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
const errors = []
try {
  browser = await chromium.connectOverCDP(endpoint)
  const page = browser.contexts()[0].pages()[0]
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.reload()
  await expect(page.locator('.paper-card')).toHaveCount(6, { timeout: 20_000 })
  expect(await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__))).toBe(true)
  expect(page.url()).toContain('tauri.localhost')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: '.tmp/windows-library.png', animations: 'disabled' })

  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/native-smoke.pdf')
  await expect(page.locator('.paper-card')).toHaveCount(7, { timeout: 20_000 })
  await page.getByRole('button', { name: '阅读 Windows Native Smoke Study', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Researchers verify', { timeout: 20_000 })
  await page
    .locator('.textLayer span')
    .filter({ hasText: 'Researchers verify' })
    .first()
    .evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await page.locator('.pdf-surface').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('Windows 原生批注验证')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.pdf-highlights span')).toHaveCount(1)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Page 2')
  await page.screenshot({ path: '.tmp/windows-pdf-reader.png', animations: 'disabled' })
  await page.reload()
  await expect(page.locator('.paper-card')).toHaveCount(7)

  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await dialog.getByLabel('模型 ID').fill('local-native-test')
  await dialog.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible({
    timeout: 20_000,
  })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Windows Native Smoke Study', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('Windows 原生批注验证')
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('已完成', { timeout: 20_000 })
  await expect(page.locator('.reading-paper')).toContainText('Windows 原生 HTTP 已收到测试响应')
  expect(requests).toHaveLength(2)
  for (const req of requests) {
    expect(req.url).toBe('/v1/chat/completions')
    expect(req.method).toBe('POST')
    expect(req.body.model).toBe('local-native-test')
  }
  await page.reload()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.getByLabel('笔记标题').fill('Windows 原生笔记')
  await page.getByLabel('Markdown 笔记正文').fill('# 原生验证\n\n**Markdown** 保存成功。')
  await expect(page.locator('.save-state')).toContainText('已保存')
  await expect(page.locator('.markdown-preview-pane strong')).toHaveText('Markdown')
  await page.reload()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/保存成功/)
  expect(errors).toEqual([])
  const report = {
    passed: true,
    url: page.url(),
    nativeHttpRequests: requests.length,
    errors,
    checks: [
      'bundled UI',
      'PDF worker and text layer',
      'page navigation',
      'annotation persistence',
      'native HTTP connection and translation',
      'Markdown preview and persistence',
    ],
  }
  await writeFile('.tmp/windows-smoke-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (browser) await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
