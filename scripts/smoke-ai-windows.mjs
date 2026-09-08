import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const stamp = Date.now()
const testDir = path.resolve(`.tmp/native-ai-${stamp}`)
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
const fakeKeys = { a: 'paperead-test-key-a', b: 'paperead-test-key-b' }
const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  let raw = ''
  for await (const bytes of req) raw += bytes
  const body = JSON.parse(raw)
  requests.push({ path: req.url, body, auth: req.headers.authorization })
  const content = body.messages?.at(-1)?.content || ''
  const paragraphs = content.includes('SOURCE_JSON:\n')
    ? JSON.parse(content.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0]).paragraphs
    : undefined
  const reply = (text) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }))
  }
  if (body.model === 'deepseek-v4-flash') {
    const source = content.includes('SOURCE_JSON:\n')
      ? JSON.parse(content.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0])
      : { text: 'OK' }
    const output = source.paragraphs
      ? source.paragraphs.map((p) => `<!-- paperead:${p.id} -->\n${p.text}`).join('\n\n')
      : source.text
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.flushHeaders()
    const delta = (value, finish_reason) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta: value, finish_reason }] })}\n\n`)
    delta({ reasoning_content: 'private test reasoning' })
    const first = setTimeout(() => delta({ content: output.slice(0, 25) }), 200)
    const finish = setTimeout(() => {
      delta({ content: output.slice(25) }, 'stop')
      res.end('data: [DONE]\n\n')
    }, 1600)
    res.on('close', () => {
      clearTimeout(first)
      clearTimeout(finish)
    })
    return
  }
  if (body.model === 'bad-output') {
    reply(
      'It looks like you pasted a manuscript. Please tell me what you would like me to do with this text.',
    )
    return
  }
  if (body.model === 'body-timeout') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.flushHeaders()
    const timer = setTimeout(() => res.end('{}'), 32_000)
    res.on('close', () => clearTimeout(timer))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.flushHeaders()
  const delta = (text, finish = null) =>
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`,
    )
  delta(
    paragraphs
      ? `<!-- paperead:${paragraphs[0].id} -->\n原生第一段译文。\n\n`
      : '# Native AI result\n\n',
  )
  if (body.model === 'cancel-stream') {
    const interval = setInterval(() => res.write(': keepalive\n\n'), 200)
    res.on('close', () => clearInterval(interval))
    return
  }
  const timer = setTimeout(() => {
    delta(
      paragraphs
        ? paragraphs
            .slice(1)
            .map((p, i) => `<!-- paperead:${p.id} -->\n原生第 ${i + 2} 段译文。`)
            .join('\n\n')
        : content.includes('SOURCE_JSON')
          ? '文献批次已按任务处理。'
          : 'OK',
      'stop',
    )
    res.end('data: [DONE]\n\n')
  }, 1500)
  res.on('close', () => clearTimeout(timer))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const a = `${base}/a/v1`,
  b = `${base}/b/v1`
const portProbe = createServer()
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
const cdpPort = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))
const quoted = (value) => `'${value.replaceAll("'", "''")}'`
const powershell = (code, env = process.env) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', code], {
    encoding: 'utf8',
    windowsHide: true,
    env,
  }).trim()
let appPid, browser, page
async function start() {
  appPid = Number(
    powershell(
      `$p = Start-Process -FilePath ${quoted(executable)} -WindowStyle Hidden -PassThru; $p.Id`,
      {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-debugging-address=127.0.0.1`,
        WEBVIEW2_USER_DATA_FOLDER: path.join(testDir, 'profile'),
      },
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
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await expect(page.locator('.paper-card')).toHaveCount(6, { timeout: 20_000 })
}
async function stop() {
  if (browser) {
    await browser.close()
    browser = undefined
  }
  if (appPid) {
    powershell(
      `$p = Get-Process -Id ${appPid} -ErrorAction SilentlyContinue; if ($p -and $p.Path -eq ${quoted(executable)}) { Stop-Process -Id ${appPid} -Force }; exit 0`,
    )
    appPid = undefined
  }
}
async function configure(endpoint, model, key) {
  await page.reload()
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await expect(page.getByText('安全保存 API Key，重启后自动使用', { exact: true })).toBeVisible()
  await page.getByLabel('API 地址').fill(endpoint)
  await page.getByLabel('模型 ID').fill(model)
  if (key) await page.getByLabel('API Key', { exact: false }).first().fill(key)
  await page.getByText('请求与性能设置', { exact: true }).click()
  await page.getByLabel('单批次超时（秒）').fill('30')
  await page.getByLabel('并行请求数').selectOption('1')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await expect(page.getByText('已保存在系统凭据存储', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
}
async function reader() {
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
}
try {
  await start()
  await configure(a, 'model-a', fakeKeys.a)
  await reader()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-live')).toContainText('正在接收模型输出')
  await expect(page.locator('.reading-paper')).toContainText('Native AI result')
  await expect(page.locator('.job-card')).toContainText('已完成', { timeout: 20_000 })
  expect(requests.every((request) => request.auth === `Bearer ${fakeKeys.a}`)).toBe(true)
  expect(requests[0].body.stream).toBe(true)
  expect(requests[0].body.messages.at(-1).content).toContain('TASK: Translate')
  checks.push('native SSE, live preview, explicit document task, first credential')
  console.log('PASS: native streaming and secure save')

  await stop()
  await start()
  await reader()
  await page.getByRole('button', { name: '开始重排', exact: false }).click()
  await expect(page.locator('.job-card').filter({ hasText: '智能重排' })).toContainText('已完成', {
    timeout: 20_000,
  })
  expect(requests.at(-1).auth).toBe(`Bearer ${fakeKeys.a}`)
  expect(requests.at(-1).body.messages.at(-1).content).toContain('TASK: Reformat')
  checks.push('credential recovered after full Windows process restart')
  console.log('PASS: credential recovery after process restart')

  await configure(b, 'model-b', fakeKeys.b)
  await reader()
  const old = page
    .locator('.job-card')
    .filter({ hasText: '智能重排' })
    .filter({ hasText: 'model-a' })
  await expect(old).toContainText('此任务使用旧配置')
  await old.getByRole('button', { name: '使用当前配置重新处理', exact: true }).click()
  await expect(
    page
      .locator('.job-card')
      .filter({ hasText: '智能重排' })
      .filter({ hasText: '1 / 1 批次 · model-b' }),
  ).toContainText('已完成', { timeout: 20_000 })
  expect(requests.at(-1).path).toBe('/b/v1/chat/completions')
  expect(requests.at(-1).auth).toBe(`Bearer ${fakeKeys.b}`)
  checks.push(
    'new endpoint/model/credential used for explicit reprocessing; original result retained',
  )
  console.log('PASS: switch endpoint and reprocess')

  await configure(b, 'bilingual')
  await reader()
  await page.getByLabel('原文对照（逐段引用原文）').check()
  const beforeBilingual = requests.length
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  const bilingualJob = page.locator('.job-card').filter({ hasText: '批次 · bilingual' })
  await expect(bilingualJob).toContainText('正在接收模型输出')
  await expect(page.locator('.reading-paper')).toContainText('原生第一段译文')
  await expect(bilingualJob).toContainText('已完成', { timeout: 20_000 })
  expect(requests.length - beforeBilingual).toBe(1)
  const bilingualSource = JSON.parse(
    requests
      .at(-1)
      .body.messages.at(-1)
      .content.split('SOURCE_JSON:\n')[1]
      .split('\nEND_SOURCE_JSON')[0],
  )
  await expect(page.locator('.reading-paper .markdown > blockquote')).toHaveCount(
    bilingualSource.paragraphs.length,
  )
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0)
  await page
    .locator('.reading-paper .markdown > p')
    .last()
    .evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await page.locator('.reading-paper .markdown').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('Windows 全文对照批注')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await page.screenshot({ path: '.tmp/windows-bilingual-014.png', animations: 'disabled' })
  await stop()
  await start()
  await reader()
  await page
    .locator('.job-card')
    .filter({ hasText: '批次 · bilingual' })
    .getByRole('button', { name: '查看结果', exact: false })
    .click()
  await page.locator('.side-tabs').getByRole('button', { name: '批注', exact: false }).click()
  await expect(page.locator('.annotation-card')).toContainText('Windows 全文对照批注')
  await expect.poll(() => page.evaluate(() => CSS.highlights.get('paper-yellow')?.size)).toBe(1)
  checks.push(
    'one cross-page bilingual request; streaming quote alignment; document annotation survives full process restart',
  )
  console.log('PASS: native continuous bilingual document and persistent annotation')

  await configure(b, 'bad-output')
  await reader()
  await page.getByRole('button', { name: '开始重排', exact: false }).click()
  await expect(page.locator('.job-card').filter({ hasText: '批次 · bad-output' })).toContainText(
    '模型返回了询问或续写建议',
  )
  checks.push('reported conversational response rejected')

  await configure(b, 'cancel-stream')
  await reader()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  const cancelling = page.locator('.job-card').filter({ hasText: '批次 · cancel-stream' })
  await expect(cancelling).toContainText('正在接收模型输出')
  await cancelling.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(cancelling).toContainText('已暂停')
  checks.push('native in-flight SSE cancellation')
  console.log('PASS: invalid task output rejected; native stream cancelled')

  await configure(b, 'body-timeout')
  await reader()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  const timing = page.locator('.job-card').filter({ hasText: '批次 · body-timeout' })
  await expect(timing).toContainText('服务商响应超时', { timeout: 40_000 })
  await expect(timing).toContainText('30 秒（body-timeout）')
  checks.push('real 30-second timeout while receiving a stalled native response body')
  console.log('PASS: native body timeout')

  await configure(a, 'model-a')
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '连接成功' })).toBeVisible({
    timeout: 20_000,
  })
  expect(requests.at(-1).auth).toBe(`Bearer ${fakeKeys.a}`)
  checks.push('switch back to saved first key and connect successfully after cancel/timeout')
  await page.screenshot({ path: '.tmp/windows-ai-015-settings.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.setTitle('Continuous Native PDF')
  for (let number = 1; number <= 2; number++) {
    const sheet = pdf.addPage([595, 842])
    sheet.drawText(`Native section ${number}`, { x: 60, y: 750, size: 22, font })
    sheet.drawText(`Paragraph from physical page ${number}.`, { x: 60, y: 700, size: 12, font })
  }
  const fixture = path.join(testDir, 'continuous.pdf')
  await writeFile(fixture, await pdf.save())
  await page.getByLabel('选择 PDF 文献').setInputFiles(fixture)
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Continuous Native PDF', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Native section 1')
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByLabel('原文对照（逐段引用原文）').check()
  const beforePdf = requests.length
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('已完成', { timeout: 20_000 })
  expect(requests.length - beforePdf).toBe(1)
  await expect(page.locator('.reading-paper .markdown > blockquote')).toHaveCount(4)
  await expect(page.locator('.reading-paper')).toContainText('Paragraph from physical page 2.')
  await page.screenshot({ path: '.tmp/windows-pdf-bilingual-014.png', animations: 'disabled' })
  checks.push(
    'actual two-page PDF import and Worker rendering; geometry recovers four paragraphs; one native bilingual request',
  )
  await configure(a, 'deepseek-v4-flash')
  const mathPdf = await PDFDocument.create(),
    mathFont = await mathPdf.embedFont(StandardFonts.TimesRoman)
  mathPdf.setTitle('Native Formula Study')
  const mathPage = mathPdf.addPage([595, 842])
  mathPage.drawText('Native Formula Study', { x: 50, y: 780, font: mathFont, size: 22 })
  mathPage.drawText('1 Method', { x: 50, y: 730, font: mathFont, size: 13 })
  mathPage.drawText('The measured energy follows a known relation in this experiment.', {
    x: 50,
    y: 695,
    font: mathFont,
    size: 10,
  })
  mathPage.drawText('E = mc', { x: 100, y: 650, font: mathFont, size: 10 })
  mathPage.drawText('2', {
    x: 100 + mathFont.widthOfTextAtSize('E = mc', 10),
    y: 654,
    font: mathFont,
    size: 6,
  })
  const mathFixture = path.join(testDir, 'math.pdf')
  await writeFile(mathFixture, await mathPdf.save())
  await page.getByLabel('选择 PDF 文献').setInputFiles(mathFixture)
  await expect(page.locator('.paper-card')).toHaveCount(8)
  await page.getByRole('button', { name: '阅读 Native Formula Study', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.document-draft')).toContainText('Native Formula')
  await expect(page.locator('.job-card')).toContainText('已完成')
  expect(requests.at(-1).body.thinking).toEqual({ type: 'disabled' })
  await expect(page.locator('.reading-paper h1')).toHaveText('Native Formula Study')
  await expect(page.locator('.reading-paper h2')).toHaveText('1 Method')
  await expect(page.locator('.reading-paper .katex-display')).toHaveCount(1)
  await expect(page.locator('.job-card')).toContainText('平均首字')
  await expect(page.locator('.reading-paper')).not.toContainText('PRM_')
  await page.screenshot({ path: '.tmp/windows-formula-016.png', animations: 'disabled' })
  checks.push(
    'DeepSeek V4 disables thinking in a real native HTTP request and displays the first text before completion',
  )
  checks.push(
    'actual PDF title and section headings plus geometric superscript are preserved as rendered Markdown and LaTeX',
  )
  checks.push(
    'native translation restores original formula tokens, persists first-text timing and hides reasoning',
  )
  expect(errors).toEqual([])
  const report = { passed: true, checks, nativeRequests: requests.length, errors }
  await writeFile('.tmp/windows-ai-016-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  // Remove only the two synthetic test credentials; never enumerate user secrets.
  if (page && !page.isClosed())
    for (const endpoint of [a, b]) {
      const account = createHash('sha256').update(`compatible:${endpoint}`).digest('hex')
      await page
        .evaluate(async (account) => {
          await window.__TAURI_INTERNALS__.invoke('delete_credential', { account })
        }, account)
        .catch(() => {})
    }
  await stop()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
