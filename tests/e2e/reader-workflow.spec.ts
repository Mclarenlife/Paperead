import { test, expect, type Page } from '@playwright/test'
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const body =
  '# Translation draft\n\n' +
  Array.from(
    { length: 25 },
    (_, i) =>
      `## Section ${i + 1}\n\nParagraph ${i + 1}. This is translated research content with enough detail to validate reading positions and versioned annotations.\n\n`,
  ).join('')
const corrected =
  '# Corrected manuscript\n\nOnlyEditedInput must reach the reflow model.\n\n' + body
test.beforeAll(async () => {
  await mkdir('.tmp', { recursive: true })
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.setTitle('Navigation Study')
  for (let i = 1; i <= 2; i++) {
    const sheet = pdf.addPage([595, 842])
    sheet.drawText(i === 1 ? 'Introduction' : 'Methods', { x: 60, y: 750, size: 24, font })
    sheet.drawText(`NeedleCrossPage appears on physical page ${i}.`, {
      x: 60,
      y: 690,
      size: 12,
      font,
    })
  }
  const outline = pdf.context.obj({ Type: 'Outlines', Count: 2 }),
    root = pdf.context.register(outline)
  const one = pdf.context.register(
    pdf.context.obj({
      Title: PDFString.of('Introduction'),
      Parent: root,
      Dest: [pdf.getPages()[0].ref, PDFName.of('Fit')],
    }),
  )
  const two = pdf.context.register(
    pdf.context.obj({
      Title: PDFString.of('Methods'),
      Parent: root,
      Prev: one,
      Dest: [pdf.getPages()[1].ref, PDFName.of('Fit')],
    }),
  )
  pdf.context.lookup(one, PDFDict).set(PDFName.of('Next'), two)
  outline.set(PDFName.of('First'), one)
  outline.set(PDFName.of('Last'), two)
  pdf.catalog.set(PDFName.of('Outlines'), root)
  await writeFile('.tmp/navigation.pdf', await pdf.save())
})
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})
async function settings(
  page: Page,
  name = '测试服务',
  endpoint = 'https://reader.example.test/v1',
  model = 'reader-model',
) {
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('配置名称', { exact: true }).fill(name)
  await page.getByLabel('API 地址').fill(endpoint)
  await page.getByLabel('模型 ID').fill(model)
  await page.getByLabel('API Key', { exact: false }).fill('test-key-for-fixture')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
}
async function selectParagraph(page: Page, comment: string) {
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
  await page.getByLabel('批注内容', { exact: true }).fill(comment)
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
}
async function translate(page: Page) {
  await settings(page)
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card').first()).toContainText('已完成')
}
test('PDF full-text search jumps across pages; outline and bookmarks persist', async ({ page }) => {
  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/navigation.pdf')
  await page.getByRole('button', { name: '阅读 Navigation Study', exact: true }).click()
  await expect(page.locator('.textLayer')).toContainText('Introduction')
  await page.keyboard.press('Control+f')
  await page.getByLabel('文献内全文查找').fill('needlecrosspage')
  await expect(page.locator('.search-match')).toHaveCount(2)
  await page.locator('.search-match').last().click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  await expect(page.locator('.textLayer')).toContainText('physical page 2')
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get('reader-search')?.size || 0))
    .toBe(1)
  await page.getByRole('button', { name: '目录', exact: true }).click()
  await page.locator('.outline-entry').filter({ hasText: 'Introduction' }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('1')
  await page.locator('.outline-entry').filter({ hasText: 'Methods' }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await page.getByLabel('书签名称').fill('方法章节')
  await page.getByRole('button', { name: '添加当前位置书签', exact: true }).click()
  await expect(page.locator('.bookmark-row')).toContainText('方法章节')
  await page.keyboard.press('Control+f')
  await expect(page.getByLabel('文献内全文查找')).toBeFocused()
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.locator('.bookmark-row').getByRole('button').first().click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  await page.getByLabel('返回文献库').click()
  await page.reload()
  await page.getByRole('button', { name: '阅读 Navigation Study', exact: true }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  await page.getByLabel('全文查找与目录').click()
  await page.getByRole('button', { name: '书签', exact: true }).click()
  await expect(page.locator('.bookmark-row')).toContainText('方法章节')
  await page.screenshot({ path: '.tmp/reader-navigation-014.png', animations: 'disabled' })
})
test('annotation edits, source filtering, text search and Markdown summary export', async ({
  page,
}) => {
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await selectParagraph(page, 'Initial comment')
  await page.getByLabel('编辑批注', { exact: true }).click()
  await page.getByLabel('编辑批注评论').fill('Edited scientific comment')
  await page.getByLabel('编辑批注颜色').selectOption('purple')
  await page.getByRole('button', { name: '保存批注修改', exact: true }).click()
  await expect(page.locator('.annotation-card')).toHaveClass(/annotation-purple/)
  await page.getByLabel('搜索批注').fill('nonexistent')
  await expect(page.locator('.annotation-card')).toHaveCount(0)
  await page.getByLabel('搜索批注').fill('scientific')
  await expect(page.locator('.annotation-card')).toHaveCount(1)
  await page.getByLabel('批注来源筛选').selectOption('translation')
  await expect(page.locator('.annotation-card')).toHaveCount(0)
  await page.getByLabel('批注来源筛选').selectOption('original')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出批注汇总/ }).click()
  await (await downloading).saveAs('.tmp/annotations-014.md')
  const output = await readFile('.tmp/annotations-014.md', 'utf8')
  expect(output).toContain('Edited scientific comment')
  expect(output).toContain('> ')
  expect(output).toContain('原文 · 第 1 页')
  await page.reload()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('Edited scientific comment')
})
test('translation can be revised, named, reflowed from that exact version and deleted independently', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const requests: any[] = []
  await page.route('https://reader.example.test/v1/chat/completions', async (route) => {
    const request = route.request().postDataJSON()
    requests.push(request)
    const reflow = request.messages.at(-1).content.includes('Reformat the provided')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: reflow ? '# Reflowed correction\n\nOnlyEditedInput was used.' : body,
            },
          },
        ],
      }),
    })
  })
  await translate(page)
  await page
    .locator('.job-card')
    .first()
    .getByRole('button', { name: '命名版本', exact: true })
    .click()
  await page.getByLabel('版本名称', { exact: true }).fill('初始译文')
  await page.getByRole('button', { name: '保存版本名称', exact: true }).click()
  await selectParagraph(page, 'Original version annotation')
  await page.getByRole('button', { name: '校对当前结果', exact: true }).click()
  await page.getByLabel('修订版本名称', { exact: true }).fill('校对定稿')
  await page.getByLabel('校对 Markdown 正文').fill(corrected)
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('OnlyEditedInput')
  await page.getByLabel('批注来源筛选').selectOption('current')
  await expect(page.locator('.annotation-card')).toHaveCount(0)
  await page.getByLabel('批注来源筛选').selectOption('all')
  await expect(page.locator('.annotation-card')).toContainText('Original version annotation')
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  // Match the version heading itself, not references to the input version on other cards.
  const originalCard = page
    .locator('.job-card')
    .filter({ has: page.locator('.result-version-name', { hasText: '初始译文' }) })
  await originalCard.getByRole('button', { name: /查看结果/ }).click()
  await expect(page.locator('.reading-paper')).not.toContainText('OnlyEditedInput')
  const revisionCard = page
    .locator('.job-card')
    .filter({ has: page.locator('.result-version-name', { hasText: '校对定稿' }) })
  await revisionCard.getByRole('button', { name: /查看结果/ }).click()
  await expect(page.locator('.reading-paper')).toContainText('OnlyEditedInput')
  await page.locator('.reader-scroll').evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.65
    el.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await page.getByLabel('返回文献库').click()
  await page.reload()
  // Browser keys are session-only; Windows credential persistence has a native test.
  await settings(page)
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('OnlyEditedInput')
  await expect
    .poll(() =>
      page
        .locator('.reader-scroll')
        .evaluate((el) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)),
    )
    .toBeGreaterThan(0.55)
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByLabel('重排输入来源').selectOption({ label: '校对定稿' })
  await page.getByRole('button', { name: /开始重排/ }).click()
  await expect(page.locator('.reading-paper')).toContainText('Reflowed correction')
  expect(requests).toHaveLength(2)
  const payload = JSON.parse(
    requests[1].messages.at(-1).content.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0],
  )
  expect(payload.text).toContain('OnlyEditedInput')
  expect(payload.text).not.toContain('Vaswani')
  await page
    .locator('.job-card')
    .filter({ has: page.locator('.result-version-name', { hasText: '校对定稿' }) })
    .getByRole('button', { name: '删除版本', exact: true })
    .click()
  await page.getByRole('button', { name: '确认删除版本', exact: true }).click()
  await expect(page.locator('.job-card')).toHaveCount(2)
  await expect(page.locator('.reading-paper')).toContainText('Reflowed correction')
  await page.screenshot({ path: '.tmp/reader-results-014.png', animations: 'disabled' })
})
test('AI correction draft warns before leaving and is recovered after reload', async ({ page }) => {
  await page.route('https://reader.example.test/v1/chat/completions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '# Result\n\nOriginal text.' } }],
      }),
    }),
  )
  await translate(page)
  await page.getByRole('button', { name: '校对当前结果', exact: true }).click()
  await page
    .getByLabel('校对 Markdown 正文')
    .fill('# Unsaved correction\n\nKeep this research edit.')
  await page.getByRole('button', { name: '关闭校对', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '校对草稿尚未保存', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await page.reload()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: '校对当前结果', exact: true }).click()
  await expect(page.getByLabel('校对 Markdown 正文')).toHaveValue(/Keep this research edit/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: '.tmp/reader-editor-mobile-014.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭校对', exact: true }).click()
  await page.getByRole('button', { name: '放弃草稿并离开', exact: true }).click()
  await expect(page.locator('.reading-paper')).toContainText('Original text.')
})
test('named API profiles switch all parameters, persist across reload and can be deleted', async ({
  page,
}) => {
  await settings(page, '快速服务', 'https://first.example.test/v1', 'fast-model')
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByRole('button', { name: '新建配置', exact: true }).click()
  await page.getByLabel('配置名称', { exact: true }).fill('推理服务')
  await page.getByLabel('API 地址').fill('https://second.example.test/v1')
  await page.getByLabel('模型 ID').fill('reasoning-model')
  await page.getByLabel('API Key', { exact: false }).fill('second-fixture-key')
  await page.getByText('请求与性能设置', { exact: true }).click()
  await page.getByLabel('单批次超时（秒）').fill('600')
  await page.getByLabel('并行请求数').selectOption('1')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByLabel('服务配置档案').selectOption({ label: '快速服务' })
  await expect(page.getByLabel('API 地址')).toHaveValue('https://first.example.test/v1')
  await expect(page.getByLabel('模型 ID')).toHaveValue('fast-model')
  await expect(page.getByLabel('单批次超时（秒）')).toHaveValue('300')
  await page.reload()
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await expect(page.getByLabel('配置名称', { exact: true })).toHaveValue('快速服务')
  await page.getByLabel('服务配置档案').selectOption({ label: '推理服务' })
  await expect(page.getByLabel('模型 ID')).toHaveValue('reasoning-model')
  await page.getByText('请求与性能设置', { exact: true }).click()
  await expect(page.getByLabel('单批次超时（秒）')).toHaveValue('600')
  await expect(page.getByLabel('并行请求数')).toHaveValue('1')
  await page.screenshot({ path: '.tmp/api-profiles-014.png', animations: 'disabled' })
  await page.getByRole('button', { name: '删除配置', exact: true }).click()
  await page.getByRole('button', { name: '确认删除配置', exact: true }).click()
  await expect(page.getByLabel('模型 ID')).toHaveValue('fast-model')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})
