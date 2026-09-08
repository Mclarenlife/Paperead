import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

test.beforeAll(async () => {
  await mkdir('.tmp', { recursive: true })
  const pdf = await PDFDocument.create()
  pdf.setTitle('Paperead Integration Study')
  pdf.setAuthor('Paperead Test Team')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let number = 1; number <= 2; number++) {
    const page = pdf.addPage([595, 842])
    page.drawText(number === 1 ? 'Paperead Integration Study' : 'Methods and Results', {
      x: 60,
      y: 750,
      size: 23,
      font,
      color: rgb(0.2, 0.3, 0.2),
    })
    const lines = [
      'This document validates PDF rendering and persistent annotations.',
      'Researchers compare local document storage with portable backups.',
      'Every selected passage can become a useful research note.',
    ]
    lines.forEach((line, i) => page.drawText(line, { x: 60, y: 690 - i * 28, size: 11, font }))
    page.drawText(`Page ${number}`, { x: 280, y: 50, size: 10, font })
  }
  await writeFile('.tmp/integration.pdf', await pdf.save())
})

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

async function importPdf(page: Page) {
  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/integration.pdf')
  await expect(page.locator('.paper-card')).toHaveCount(7, { timeout: 20000 })
}

test('real PDF import, duplicate prevention, page rendering, highlight and persistence', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await importPdf(page)
  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/integration.pdf')
  await expect(page.getByRole('status')).toContainText('已在文献库中')
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Paperead Integration Study', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Researchers compare')
  const target = page.locator('.textLayer span').filter({ hasText: 'Researchers compare' }).first()
  const rect = await target.boundingBox()
  expect(rect?.width).toBeGreaterThan(100)
  await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.locator('.pdf-surface').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('This is an important finding.')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('important finding')
  await expect(page.locator('.pdf-highlights span')).toHaveCount(1)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Methods and Results')
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.locator('.pdf-highlights span')).toHaveCount(1)
  await page.screenshot({ path: '.tmp/pdf-reader.png', fullPage: true })
  await page.reload()
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Paperead Integration Study', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('important finding')
  await expect(page.locator('.textLayer')).toContainText('Researchers compare')
  expect(errors).toEqual([])
})

test('search, favorite, collection, note editing and export', async ({ page }) => {
  await page.getByLabel('搜索文献').fill('Vaswani')
  await expect(page.locator('.paper-card')).toHaveCount(1)
  await page
    .getByRole('button', { name: '取消收藏 Attention Is All You Need', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '收藏 Attention Is All You Need', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await page.getByRole('button', { name: '新建文献集', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('名称').fill('我的测试研究')
  await page.getByRole('button', { name: '创建文献集', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的测试研究' })).toBeVisible()
  await page.getByLabel('管理文献集').click()
  await page.getByLabel('文献集名称').fill('更新后的研究')
  await page.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect(page.getByRole('heading', { name: '更新后的研究' })).toBeVisible()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.getByLabel('笔记标题').fill('Research Notes')
  await page
    .getByLabel('Markdown 笔记正文')
    .fill('# Evidence\n\nA **persistent** research note.\n\n- [x] Read the paper')
  await expect(page.locator('.save-state')).toContainText('已保存')
  await expect(page.locator('.markdown-preview-pane strong')).toHaveText('persistent')
  const downloading = page.waitForEvent('download')
  await page.getByLabel('导出笔记 Markdown').click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('Research Notes.md')
  await download.saveAs('.tmp/exported-note.md')
  await page.reload()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/persistent/)
})

test('configured AI sends real request shape, saves translation and supports export', async ({
  page,
}) => {
  const inputs: unknown[] = []
  await page.route('https://api.example.test/v1/chat/completions', async (route) => {
    inputs.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '# 翻译结果\n\n这是一段用于接口测试的译文。' },
          },
        ],
      }),
    })
  })
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API 地址').fill('https://api.example.test/v1')
  await dialog.getByLabel('模型 ID').fill('test-model')
  await dialog.getByLabel('API Key', { exact: false }).fill('test-secret')
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('已完成')
  await expect(page.locator('.reading-paper')).toContainText('这是一段用于接口测试的译文')
  expect(inputs).toHaveLength(1)
  expect(JSON.stringify(inputs[0])).toContain('SOURCE_JSON')
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0)
  await page
    .locator('.reading-paper .markdown p')
    .first()
    .evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await page.locator('.reading-paper .markdown').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('译文中的思考')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('译文中的思考')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'MD 开放的 Markdown' }).click()
  await (await downloading).saveAs('.tmp/translated.md')
  await page.reload()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: '智能翻译', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('这是一段用于接口测试的译文')
  await expect(page.locator('.annotation-card')).toContainText('译文中的思考')
})

test('complete ZIP backup restores actual PDF bytes and metadata after deletion', async ({
  page,
}) => {
  await importPdf(page)
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await (await downloading).saveAs('.tmp/full-backup.zip')
  const zip = await JSZip.loadAsync(await readFile('.tmp/full-backup.zip'))
  const pdfEntry = Object.values(zip.files).find((file) => file.name.endsWith('.pdf'))!
  expect(await pdfEntry.async('nodebuffer')).toEqual(await readFile('.tmp/integration.pdf'))
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Paperead Integration Study', exact: true }).click()
  await page.getByLabel('编辑文献信息').click()
  await page.getByRole('button', { name: '删除文献', exact: true }).click()
  await page
    .getByRole('dialog', { name: '移入回收站', exact: true })
    .getByRole('button', { name: '确认移入回收站', exact: true })
    .click()
  await expect(page.locator('.paper-card')).toHaveCount(6)
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByLabel('导入完整备份', { exact: true }).setInputFiles('.tmp/full-backup.zip')
  await expect(page.getByRole('dialog', { name: '恢复备份预览' })).toContainText('覆盖')
  await page.getByRole('button', { name: '创建快照并确认恢复' }).click()
  await expect(page.getByRole('status')).toContainText('已恢复 7 篇文献')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Paperead Integration Study', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Researchers compare')
})

test('exports independent HTML, text and Word documents with actual readable content', async ({
  page,
}) => {
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  for (const [format, label] of [
    ['html', 'HTML 独立阅读页面'],
    ['txt', 'TXT 纯文本内容'],
    ['docx', 'DOCX Word 表格与公式'],
  ]) {
    await page.getByRole('button', { name: '导出', exact: true }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: label, exact: true }).click()
    await (await downloading).saveAs(`.tmp/export-check.${format}`)
    const bytes = await readFile(`.tmp/export-check.${format}`)
    if (format === 'docx') {
      const zip = await JSZip.loadAsync(bytes)
      expect(await zip.file('word/document.xml')!.async('string')).toContain(
        'Attention Is All You Need',
      )
    } else expect(bytes.toString()).toContain('Attention Is All You Need')
  }
})

test('rejects a corrupt PDF without creating partial records', async ({ page }) => {
  await page.getByLabel('选择 PDF 文献').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a real PDF'),
  })
  await expect(page.getByRole('status')).toContainText('不是有效的 PDF')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

test('AI reflow reports rate limits and resumes the unfinished task', async ({ page }) => {
  let requests = 0
  await page.route('http://127.0.0.1:11434/v1/chat/completions', async (route) => {
    requests++
    await route.fulfill(
      requests === 1
        ? { status: 429, contentType: 'application/json', body: '{}' }
        : {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '# Reflowed document\n\nThe original language and source content are preserved.',
                  },
                },
              ],
            }),
          },
    )
  })
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('API 地址').fill('http://127.0.0.1:11434/v1')
  await page.getByLabel('模型 ID').fill('local-test-model')
  await page.getByText('请求与性能设置', { exact: true }).click()
  await page.getByLabel('并行请求数').selectOption('1')
  await page.getByLabel('批次大小（字符）').fill('1000')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始重排', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('HTTP 429')
  await page.locator('.job-card').getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.locator('.job-card')).toContainText('已完成')
  await expect(page.locator('.reading-paper')).toContainText('Reflowed document')
  expect(requests).toBe(3)
})

test('bilingual PDF becomes one Markdown with paragraph quotes, document annotations and exact history versions', async ({
  page,
}) => {
  const errors: string[] = [],
    sources: { paragraphs?: { id: string; text: string }[]; text?: string }[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await importPdf(page)
  // Emulate a pre-upgrade import whose stored extraction flattened the paragraphs.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('paperead-v1')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite'),
        store = tx.objectStore('pages'),
        cursor = store.openCursor()
      cursor.onsuccess = () => {
        const row = cursor.result
        if (!row) return
        if (!row.value.paperId.startsWith('sample-'))
          row.update({ ...row.value, text: 'Old flattened text', extractionVersion: undefined })
        row.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.route('http://127.0.0.1:11435/v1/chat/completions', async (route) => {
    const request = route.request().postDataJSON(),
      input = request.messages.at(-1).content as string
    const payload = JSON.parse(input.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0])
    sources.push(payload)
    const content = payload.paragraphs
      ? payload.paragraphs
          .map((p: { id: string }, i: number) => `<!-- paperead:${p.id} -->\n第 ${i + 1} 段译文。`)
          .join('\n\n')
      : `# Continuous reflow\n\n${payload.text}`
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }),
    })
  })
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('API 地址').fill('http://127.0.0.1:11435/v1')
  await page.getByLabel('模型 ID').fill('document-test')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '偏好设置', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '阅读 Paperead Integration Study', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByLabel('原文对照（逐段引用原文）').check()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('已完成')
  expect(sources).toHaveLength(1)
  expect(sources[0].paragraphs!.length).toBeGreaterThan(6)
  expect(sources[0].paragraphs!.some((p) => p.text === '## Methods and Results')).toBe(true)
  await expect(page.locator('.reading-paper blockquote')).toHaveCount(sources[0].paragraphs!.length)
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0)
  const last = page.locator('.reading-paper .markdown > p').last()
  await last.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page.locator('.reading-paper .markdown').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('跨页译文的全文批注')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('全文')
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'MD 开放的 Markdown' }).click()
  await (await download).saveAs('.tmp/bilingual-document.md')
  const markdown = await readFile('.tmp/bilingual-document.md', 'utf8')
  expect(markdown).toBe(
    sources[0]
      .paragraphs!.map(
        (p, i) => `> ${p.text}\n\n${p.text.match(/^#{1,6}\s/)?.[0] || ''}第 ${i + 1} 段译文。`,
      )
      .join('\n\n'),
  )
  expect(markdown).not.toMatch(/source-page|paperead:|\n---\n/)
  await page.screenshot({ path: '.tmp/bilingual-document.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始重排', exact: false }).click()
  await expect(page.locator('.job-card').filter({ hasText: '智能重排' })).toContainText('已完成')
  expect(sources).toHaveLength(2)
  expect(sources[1].text).toContain('Methods and Results')
  await expect(page.locator('.reading-paper')).toContainText('Continuous reflow')
  await page.reload()
  await page.getByRole('button', { name: '探索 AI 工作台', exact: false }).click()
  await page
    .locator('.job-card')
    .filter({ hasText: '智能翻译' })
    .getByRole('button', { name: '查看结果', exact: false })
    .click()
  await expect(page.locator('.document-mode-label')).toContainText('原文对照')
  await expect(page.locator('.reading-paper blockquote')).toHaveCount(sources[0].paragraphs!.length)
  await page.locator('.side-tabs').getByRole('button', { name: '批注', exact: false }).click()
  await expect(page.locator('.annotation-card')).toContainText('跨页译文的全文批注')
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get('paper-yellow')?.size))
    .toBe(1)
  await page
    .locator('.annotation-card')
    .getByRole('button', { name: '全文 · 译文', exact: true })
    .click()
  await expect(last).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(errors).toEqual([])
})

test('mobile library and notes stay inside the viewport; theme persists', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByLabel('打开导航').click()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByLabel('工作区设置').click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await page.getByRole('button', { name: '夜读', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.paper-card').last()).toHaveCSS('opacity', '1')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(27, 35, 31)')
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({
    path: '.tmp/library-dark-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
})
