import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { writeFile } from 'node:fs/promises'

test.beforeAll(async () => {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Continuous Reader Study')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let number = 1; number <= 24; number++) {
    const sheet = pdf.addPage(number % 4 === 0 ? [842, 595] : [595, 842])
    sheet.drawText(`Continuous Reader Study - page ${number}`, {
      x: 40,
      y: sheet.getHeight() - 60,
      size: 20,
      font,
    })
    sheet.drawText(`Evidence and findings on physical page ${number}.`, {
      x: 40,
      y: sheet.getHeight() - 110,
      size: 14,
      font,
    })
    sheet.drawText('Each paragraph can be selected and annotated independently.', {
      x: 40,
      y: sheet.getHeight() - 150,
      size: 12,
      font,
    })
  }
  await writeFile('.tmp/continuous-reader.pdf', await pdf.save())
})

async function openPaper(page: Page) {
  await page.goto('/')
  await page.getByLabel('选择 PDF 文献').setInputFiles('.tmp/continuous-reader.pdf')
  await page.getByRole('button', { name: '阅读 Continuous Reader Study', exact: true }).click()
  await expect(page.locator('.pdf-page-slot[data-page="1"] .pdf-surface')).toHaveAttribute(
    'data-ready',
    'true',
  )
}

async function scrollTo(page: Page, number: number) {
  await page.locator(`.pdf-page-slot[data-page="${number}"]`).waitFor({ state: 'attached' })
  await page.locator('.pdf-scroll').evaluate((element, number) => {
    const slot = element.querySelector<HTMLElement>(`.pdf-page-slot[data-page="${number}"]`)!
    element.scrollTop += slot.getBoundingClientRect().top - element.getBoundingClientRect().top + 40
  }, number)
  await expect(page.getByLabel('跳转页码')).toHaveValue(String(number))
  await expect(page.locator(`.pdf-page-slot[data-page="${number}"] .pdf-surface`)).toHaveAttribute(
    'data-ready',
    'true',
  )
}

test('continuous PDF scrolls, virtualizes canvases, anchors annotations and restores page position', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openPaper(page)
  await expect(page.locator('.reader-header')).toHaveCount(0)
  await expect(page.getByRole('toolbar', { name: '文献工具栏' })).toHaveCount(1)
  await expect(page.locator('.pdf-page-slot')).toHaveCount(24)
  await scrollTo(page, 2)
  const line = page
    .locator('.pdf-page-slot[data-page="2"] .textLayer span')
    .filter({ hasText: 'Evidence and findings' })
  await line.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  await page.locator('.pdf-page-slot[data-page="2"] .pdf-surface').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('Continuous page two annotation')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('第 2 页')
  await expect(page.locator('.pdf-page-slot[data-page="2"] .pdf-highlights span')).toHaveCount(1)
  await page.getByLabel('跳转页码').fill('18')
  await expect(page.locator('.pdf-page-slot[data-page="18"] .pdf-surface')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await scrollTo(page, 19)
  await expect.poll(() => page.locator('.pdf-continuous canvas').count()).toBeLessThan(9)
  await expect(page.locator('.pdf-page-slot[data-page="1"] canvas')).toHaveCount(0)
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('19')
  await page.getByRole('button', { name: '切换批注面板', exact: true }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('19')
  await page.setViewportSize({ width: 1100, height: 1000 })
  await expect(page.getByLabel('跳转页码')).toHaveValue('19')
  await expect(page.locator('.pdf-page-slot[data-page="19"] .pdf-surface')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByLabel('返回文献库').click()
  await page.reload()
  await page.getByRole('button', { name: '阅读 Continuous Reader Study', exact: true }).click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('19')
  await expect(page.locator('.pdf-page-slot[data-page="19"] .pdf-surface')).toHaveAttribute(
    'data-ready',
    'true',
  )
  await page
    .locator('.annotation-card')
    .getByRole('button', { name: '第 2 页 · 原文', exact: true })
    .click()
  await expect(page.getByLabel('跳转页码')).toHaveValue('2')
  await expect(page.locator('.pdf-page-slot[data-page="2"] .pdf-highlights span')).toHaveCount(1)
  await page.screenshot({ path: '.tmp/continuous-reader-0.1.11.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('comparison shows independent PDF and translation panes; annotations retain their source', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.route('https://compare.example.test/v1/chat/completions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content:
                '# 翻译结果\n\n' +
                Array.from(
                  { length: 45 },
                  (_, i) => `第 ${i + 1} 段译文。保留独立滚动和逐段阅读的位置。`,
                ).join('\n\n'),
            },
          },
        ],
      }),
    }),
  )
  await openPaper(page)
  await page.getByLabel('返回文献库').click()
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await page.getByLabel('API 地址').fill('https://compare.example.test/v1')
  await page.getByLabel('模型 ID').fill('compare-test-model')
  await page.getByLabel('API Key', { exact: false }).fill('test-key')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Continuous Reader Study', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await expect(page.getByRole('button', { name: /开始重排/ })).toHaveCount(0)
  await page.getByRole('button', { name: /开始翻译/ }).click()
  await expect(page.locator('.job-card')).toContainText('已完成', { timeout: 30_000 })
  await page.getByRole('button', { name: '对照', exact: true }).click()
  await expect(page.getByRole('region', { name: '原文窗口', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '译文窗口', exact: true })).toBeVisible()
  await scrollTo(page, 8)
  const before = await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop)
  await page.locator('.translation-scroll').evaluate((el) => {
    el.scrollTop = 400
    el.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  expect(await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0)
  const paragraph = page.locator('.translation-pane .markdown > p').first()
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
  })
  await page.locator('.translation-pane .markdown').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('Translation pane annotation')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('全文 · 译文')
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get('paper-yellow')?.size))
    .toBe(1)
  await page.locator('.pdf-scroll').dispatchEvent('wheel', { deltaY: 10 })
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get('paper-yellow')?.size))
    .toBe(1)
  await page.getByRole('button', { name: '切换批注面板', exact: true }).click()
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 12_000 })
  await page.screenshot({ path: '.tmp/comparison-0.1.11-light.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  const original = await page.locator('.original-pane').boundingBox(),
    translated = await page.locator('.translation-pane').boundingBox()
  expect(translated!.y).toBeGreaterThanOrEqual(original!.y + original!.height - 1)
  expect(original!.height).toBeGreaterThan(200)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: '.tmp/comparison-0.1.11-mobile.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await page.getByRole('button', { name: '夜读', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.translation-pane')).toBeVisible()
  await page.screenshot({ path: '.tmp/comparison-0.1.11-dark.png', animations: 'disabled' })
})
