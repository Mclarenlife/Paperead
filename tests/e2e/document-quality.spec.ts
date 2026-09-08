import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

test('real PDF preserves headings, two-column paragraphs and scripts; upgrading extraction preserves recognized pages', async ({
  page,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.TimesRoman)
  pdf.setTitle('Layout Quality Study')
  const sheet = pdf.addPage([595, 842])
  sheet.drawText('Layout Quality Study', { x: 50, y: 790, size: 22, font })
  sheet.drawText('1 Introduction', { x: 50, y: 750, size: 13, font })
  for (let i = 0; i < 4; i++) {
    sheet.drawText(`Left body line ${i} with research evidence`, {
      x: 50,
      y: 720 - i * 14,
      size: 10,
      font,
    })
    sheet.drawText(`Right body line ${i} with other evidence`, {
      x: 325,
      y: 720 - i * 14,
      size: 10,
      font,
    })
  }
  sheet.drawText('E = mc', { x: 100, y: 610, size: 10, font })
  sheet.drawText('2', { x: 100 + font.widthOfTextAtSize('E = mc', 10), y: 614, size: 6, font })
  const second = pdf.addPage([595, 842])
  second.drawText('Old second page', { x: 50, y: 700, size: 12, font })
  await mkdir('.tmp/quality-016', { recursive: true })
  await writeFile('.tmp/quality-016/layout.pdf', await pdf.save())
  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/quality-016/layout.pdf')
  await expect(page.locator('.paper-card')).toHaveCount(7, { timeout: 20000 })
  const result = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p),
      { db } = await load('/src/lib/db.ts')
    const paper = await db.papers.filter((p: any) => p.title === 'Layout Quality Study').first()
    const first = await db.pages.get(`${paper.id}:1`)
    await db.pages.update(`${paper.id}:1`, { extractionVersion: 2, text: 'legacy flattened text' })
    await db.pages.update(`${paper.id}:2`, {
      extractionVersion: 2,
      text: '## Recognized math\n\n$$\\frac{a}{b}$$',
      recognition: { engine: 'vision', model: 'vision-test', updatedAt: 1 },
    })
    const { refreshDocumentPages } = await load('/src/lib/pdf.ts')
    const refreshed = await refreshDocumentPages(paper.id)
    return { first, refreshed }
  })
  expect(result.first.text).toContain('# Layout Quality Study')
  expect(result.first.text).toContain('## 1 Introduction')
  expect(result.first.text).toContain('$$\nE = mc^{2}\n$$')
  expect(result.first.text.indexOf('Right body line 0')).toBeGreaterThan(
    result.first.text.indexOf('Left body line 3'),
  )
  expect(result.refreshed[0].text).toBe(result.first.text)
  expect(result.refreshed[1].text).toBe('## Recognized math\n\n$$\\frac{a}{b}$$')
  await page.getByRole('button', { name: '阅读 Layout Quality Study', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Layout Quality Study')
  await page.screenshot({ path: '.tmp/quality-016/source-layout.png' })
})

test('actual SSE shows later batches immediately, uses V4 non-thinking, and exports one ordered Markdown with exact math', async ({
  page,
}) => {
  test.setTimeout(60000)
  const requests: any[] = []
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    let raw = ''
    for await (const bytes of req) raw += bytes
    const body = JSON.parse(raw),
      index = requests.length
    requests.push(body)
    const source = JSON.parse(
      body.messages[1].content.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0],
    )
    const text = source.text.replace('Introduction', '引言').replaceAll('Evidence', '证据')
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.flushHeaders()
    const send = (delta: any, finish_reason?: string) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`)
    // Simulate a gateway that ignores the thinking override. Status must be honest.
    send({ reasoning_content: 'not for the document' })
    const timer = setTimeout(
      () => {
        send({ content: text })
        const finish = setTimeout(() => {
          send({}, 'stop')
          res.end('data: [DONE]\n\n')
        }, 400)
        res.on('close', () => clearTimeout(finish))
      },
      index === 0 ? 4000 : 60,
    )
    res.on('close', () => clearTimeout(timer))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  try {
    await page.evaluate(async () => {
      const load = (p: string) => import(/* @vite-ignore */ p),
        { db } = await load('/src/lib/db.ts')
      await db.pages.where('paperId').equals('sample-0').delete()
      await db.papers.update('sample-0', { pageCount: 14 })
      await db.pages.bulkAdd(
        Array.from({ length: 14 }, (_, i) => ({
          id: `sample-0:${i + 1}`,
          paperId: 'sample-0',
          number: i + 1,
          text:
            (i === 0 ? '# Research\n\n## Introduction\n\n' : '') +
            `Evidence ${i + 1}. ` +
            'Research sentence with consistent terminology. '.repeat(10) +
            (i === 0 ? '\n\n$$\n\\frac{a}{b} + x_i^{2}\n$$' : ''),
          extractionVersion: 3,
        })),
      )
    })
    await page.getByRole('button', { name: '偏好设置', exact: false }).click()
    await page.getByLabel('API 地址').fill(`http://127.0.0.1:${port}/v1`)
    await page.getByLabel('模型 ID').fill('deepseek-v4-flash')
    await page.getByText('请求与性能设置', { exact: true }).click()
    await expect(page.getByLabel('DeepSeek 思考模式')).toHaveValue('auto')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
    await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
    await page.getByRole('button', { name: '开始翻译', exact: false }).click()
    await expect(page.getByLabel('并行内容预览')).toContainText('证据')
    await expect(page.locator('.job-card')).toContainText('尚未返回正文')
    await page.screenshot({ path: '.tmp/quality-016/parallel.png' })
    await expect(page.locator('.job-card')).toContainText('已完成')
    await expect(page.locator('.reading-paper h2').filter({ hasText: '引言' })).toHaveCount(1)
    await expect(page.locator('.reading-paper .katex-display')).toHaveCount(1)
    await expect(page.getByLabel('并行内容预览')).toHaveCount(0)
    const saved = await page.evaluate(async () => {
      const load = (p: string) => import(/* @vite-ignore */ p),
        { db } = await load('/src/lib/db.ts')
      return (await db.jobs.toArray())[0]
    })
    const markdown = saved.chunks.map((c: any) => c.output).join('\n\n')
    expect(markdown.indexOf('证据 1.')).toBeLessThan(markdown.indexOf('证据 14.'))
    expect(markdown).toContain('$$\n\\frac{a}{b} + x_i^{2}\n$$')
    expect(markdown).not.toMatch(/PRM_|not for the document|并行预览/)
    expect(requests.every((b) => b.thinking.type === 'disabled' && b.stream)).toBe(true)
    expect(requests).toHaveLength(2)
    await page.screenshot({ path: '.tmp/quality-016/completed.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '.tmp/quality-016/mobile.png' })
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r())
      server.closeAllConnections()
    })
  }
})
